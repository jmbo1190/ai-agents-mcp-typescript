/**
 * Hybrid Expense Server
 *
 * In this approach, we combine the best of both:
 * - Agent extracts from natural language (flexible input)
 * - Tool normalizes and validates (deterministic processing)
 * - Tool enforces business rules (consistent)
 * - Tool provides context-aware guidance (intelligent)
 *
 * Result: Low token cost, high flexibility, high consistency
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { database, storage } from "./database.js";

const server = new McpServer({
  name: "expense-hybrid",
  version: "1.0.0",
});

interface ToolResult {
  status: "success" | "needs_receipt" | "needs_approval" | "needs_clarification" | "failed";
  message: string;
  next_action?: string;
  next_action_params?: Record<string, unknown>;
  alternative_actions?: Array<{
    action: string;
    description: string;
    when_to_use: string;
    params?: Record<string, unknown>;
  }>;
  hint?: string;
  tell_user?: string;
  [key: string]: unknown;
}

function toolResponse(result: ToolResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

// Hybrid: Flexible input, smart processing
server.tool(
  "submit_expense",
  "Submit an expense. Provide natural description and context; tool handles categorization and validation.",
  {
    amount: z.number().describe("Expense amount in dollars"),

    // Agent provides description in natural language
    description: z.string().describe("What was purchased or paid for (in user's own words)"),

    // Agent extracts context clues from conversation
    context: z
      .object({
        has_client_involved: z
          .boolean()
          .optional()
          .describe("Was a client or customer present or involved?"),
        is_team_event: z.boolean().optional().describe("Was this a team event or group activity?"),
        is_recurring: z.boolean().optional().describe("Is this a recurring expense?"),
        urgency: z
          .enum(["normal", "urgent"])
          .optional()
          .describe("How urgently does this need to be processed?"),
      })
      .optional()
      .describe("Contextual information to help categorize and route the expense"),

    receipt_url: z.string().optional().describe("URL to receipt if already uploaded"),
    approval_id: z.string().optional().describe("Manager approval ID if already obtained"),
  },
  async ({ amount, description, context, receipt_url, approval_id }) => {
    // TOOL INTELLIGENTLY DETERMINES CATEGORY
    const category = determineCategory(description, context);

    // If category is ambiguous, ask for clarification
    if (category === "unknown") {
      const suggestions = suggestCategories(description);
      return toolResponse({
        status: "needs_clarification",
        message: "Could not determine expense category from description",
        description_provided: description,
        suggested_categories: suggestions,
        hint: "Description is ambiguous. Present category options to user or ask for more details about what this expense was for.",
        tell_user:
          "I'm not sure how to categorize this expense. Could you tell me more about what it was for?",
      });
    }

    // TOOL USES CONTEXT FOR BETTER DECISIONS
    const rules = database.getCategoryRules(category);
    const isUrgent = context?.urgency === "urgent";

    // Urgent expenses might have different thresholds
    const effectiveApprovalThreshold = isUrgent
      ? rules.approval_required_over * 1.5
      : rules.approval_required_over;

    // Standard validations
    if (amount <= 0) {
      return toolResponse({
        status: "failed",
        message: "Amount must be greater than zero",
        error: "invalid_amount",
        hint: "Amount is not valid. Ask user to verify the expense amount.",
      });
    }

    if (amount > rules.max_amount) {
      return toolResponse({
        status: "failed",
        message: `${category} expenses cannot exceed $${rules.max_amount}`,
        error: "amount_too_high",
        max_allowed: rules.max_amount,
        current_amount: amount,
        current_category: category,
        alternative_actions: [
          {
            action: "split_expense",
            description: "Split this into multiple smaller expenses",
            when_to_use: "The expense can be logically divided into separate items",
          },
          {
            action: "request_exception",
            description: "Request a policy exception for this amount",
            when_to_use: "The expense is justified but exceeds normal limits",
            params: {
              amount,
              category,
              justification: `Expense of $${amount} exceeds ${category} limit of $${rules.max_amount}`,
            },
          },
          {
            action: "recategorize",
            description: "Consider if this should be in a different category",
            when_to_use: "The expense might fit better in another category with higher limits",
          },
        ],
        hint: "Amount exceeds maximum. Present alternatives to user.",
        tell_user: `This ${category} expense of $${amount} exceeds our $${rules.max_amount} limit. We have a few options...`,
      });
    }

    // TOOL CHECKS RECEIPT (with context-aware messaging)
    if (amount > rules.receipt_required_over && !receipt_url) {
      return toolResponse({
        status: "needs_receipt",
        message: `${category} expenses over $${rules.receipt_required_over} require a receipt`,
        category,
        amount,
        receipt_threshold: rules.receipt_required_over,
        next_action: "upload_receipt",
        next_action_params: {
          expense_amount: amount,
          expense_description: description,
          supported_formats: ["image/jpeg", "image/png", "application/pdf"],
          max_size_mb: 10,
        },
        hint: isUrgent
          ? "This is urgent. Explain that receipt can be uploaded immediately via phone camera."
          : "Ask user to provide receipt photo. After upload, retry submit_expense with receipt_url.",
        tell_user: isUrgent
          ? "I'll need the receipt right away since this is urgent. You can snap a photo with your phone and upload it."
          : "I'll need a photo or scan of the receipt to process this expense.",
      });
    }

    // TOOL CHECKS APPROVAL (with contextual routing)
    if (amount > effectiveApprovalThreshold && !approval_id) {
      return toolResponse({
        status: "needs_approval",
        message: `${category} expenses over $${effectiveApprovalThreshold} require approval`,
        category,
        amount,
        approval_threshold: effectiveApprovalThreshold,
        is_urgent: isUrgent,
        next_action: "request_approval",
        next_action_params: {
          amount,
          category,
          description,
          receipt_url,
          urgency: context?.urgency || "normal",
        },
        hint: isUrgent
          ? "Mark as urgent. Approver will be notified to expedite."
          : "Request approval from manager. Standard timeline is 2-3 business days.",
        tell_user: isUrgent
          ? "This needs approval, but I'll mark it as urgent for faster processing. Your manager will be notified immediately."
          : "I'll send this to your manager for approval. This typically takes a couple of days.",
      });
    }

    // TOOL CREATES WITH FULL CONTEXT
    const expense = await database.createExpense({
      amount,
      category,
      description,
      receipt_url,
      approval_id,
      status: "approved",
      metadata: {
        has_client: context?.has_client_involved,
        is_team_event: context?.is_team_event,
        is_recurring: context?.is_recurring,
        urgency: context?.urgency,
        original_description: description,
      },
    });

    return toolResponse({
      status: "success",
      expense_id: expense.id,
      expense_number: expense.number,
      category,
      amount,
      message: `Expense ${expense.number} submitted successfully`,
      tell_user: `Your ${category} expense for $${amount.toFixed(2)} has been submitted.${
        isUrgent ? " Marked as urgent for priority processing." : ""
      }`,
    });
  }
);

// HELPER: Smart categorization based on description + context
function determineCategory(
  description: string,
  context?: { has_client_involved?: boolean; is_team_event?: boolean }
): string {
  const lower = description.toLowerCase();

  // Check for meal-related keywords
  if (
    lower.includes("dinner") ||
    lower.includes("lunch") ||
    lower.includes("breakfast") ||
    lower.includes("meal") ||
    lower.includes("restaurant") ||
    lower.includes("food")
  ) {
    if (context?.has_client_involved) {
      return "client_entertainment";
    }
    if (context?.is_team_event) {
      return "team_meals";
    }
    return "meals";
  }

  // Check for travel keywords
  if (
    lower.includes("flight") ||
    lower.includes("hotel") ||
    lower.includes("rental") ||
    lower.includes("uber") ||
    lower.includes("taxi") ||
    lower.includes("airbnb")
  ) {
    return "travel";
  }

  // Check for software keywords
  if (
    lower.includes("software") ||
    lower.includes("subscription") ||
    lower.includes("saas") ||
    lower.includes("license")
  ) {
    return "software";
  }

  // Check for supplies keywords
  if (
    lower.includes("office") ||
    lower.includes("supplies") ||
    lower.includes("equipment") ||
    lower.includes("furniture")
  ) {
    return "supplies";
  }

  return "unknown";
}

function suggestCategories(description: string): Array<{ name: string; confidence: number }> {
  const suggestions: Array<{ name: string; confidence: number }> = [];
  const lower = description.toLowerCase();

  if (lower.includes("eat") || lower.includes("food")) {
    suggestions.push({ name: "meals", confidence: 0.7 });
  }
  if (lower.includes("client") || lower.includes("customer")) {
    suggestions.push({ name: "client_entertainment", confidence: 0.6 });
  }
  if (lower.includes("trip") || lower.includes("travel")) {
    suggestions.push({ name: "travel", confidence: 0.8 });
  }
  if (lower.includes("buy") || lower.includes("purchase")) {
    suggestions.push({ name: "supplies", confidence: 0.5 });
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

server.tool(
  "upload_receipt",
  "Upload a receipt image",
  {
    file_data: z.string().describe("Base64 encoded file data"),
    file_type: z.string().describe("File mime type"),
    expense_description: z.string().optional().describe("Description of the expense"),
  },
  async ({ file_data, file_type }) => {
    const receipt = await storage.uploadReceipt(file_data, file_type);

    return toolResponse({
      status: "success",
      receipt_url: receipt.url,
      receipt_id: receipt.id,
      message: "Receipt uploaded successfully",
      next_action: "submit_expense",
      hint: "Now retry submit_expense with this receipt_url",
    });
  }
);

server.tool(
  "request_approval",
  "Request manager approval",
  {
    amount: z.number(),
    category: z.string(),
    description: z.string(),
    receipt_url: z.string().optional(),
    urgency: z.enum(["normal", "urgent"]).optional(),
  },
  async ({ amount, category, description, urgency }) => {
    const approval = await database.createApproval({
      amount,
      category,
      description,
    });

    const isUrgent = urgency === "urgent";

    return toolResponse({
      status: "success",
      approval_id: approval.id,
      approval_status: approval.status,
      approver: approval.approver_name,
      is_urgent: isUrgent,
      message: `Approval request sent to ${approval.approver_name}`,
      next_action: "wait",
      hint: isUrgent
        ? "Urgent approval requested. Typical response time is 24 hours."
        : "Tell user the approval request has been sent. Standard response time is 1-2 business days.",
      tell_user: `I've sent the approval request to ${approval.approver_name}.${
        isUrgent ? " Since this is urgent, they'll typically respond within 24 hours." : " This usually takes 1-2 business days."
      }`,
    });
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hybrid Expense Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
