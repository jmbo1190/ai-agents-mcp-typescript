/**
 * Tool-Heavy Expense Server
 *
 * In this approach, all business logic lives in the tool.
 * The agent must:
 * - Extract facts from user input
 * - Map to expected enums/types
 * - Call the tool
 * - Follow the tool's instructions
 *
 * Result: Low token cost, high consistency, but requires structured input
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { database, storage } from "./database.js";

const server = new McpServer({
  name: "expense-tool-heavy",
  version: "1.0.0",
});

interface ToolResult {
  status: "success" | "needs_receipt" | "needs_approval" | "failed";
  message: string;
  next_action?: string;
  next_action_params?: Record<string, unknown>;
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

// Tool-Heavy: All business logic in the tool
server.tool(
  "submit_expense",
  "Submit an expense. Tool handles all validation, categorization, and workflow orchestration.",
  {
    amount: z.number().describe("Expense amount in dollars"),
    expense_type: z
      .enum(["meal", "travel", "supplies", "software"])
      .describe("General type of expense"),
    description: z.string().describe("Brief description of the expense"),
    has_client_attendees: z
      .boolean()
      .optional()
      .describe("Was a client present at this expense event?"),
    receipt_url: z.string().optional().describe("URL to receipt if already uploaded"),
    approval_id: z.string().optional().describe("Manager approval ID if already obtained"),
  },
  async ({ amount, expense_type, description, has_client_attendees, receipt_url, approval_id }) => {
    // TOOL DETERMINES CATEGORY (not agent)
    let category: string;
    if (expense_type === "meal" && has_client_attendees) {
      category = "client_entertainment";
    } else if (expense_type === "meal") {
      category = "meals";
    } else {
      category = expense_type;
    }

    // TOOL KNOWS ALL THE RULES
    const rules = database.getCategoryRules(category);

    // TOOL VALIDATES AMOUNT
    if (amount <= 0) {
      return toolResponse({
        status: "failed",
        message: "Amount must be greater than zero",
        error: "invalid_amount",
      });
    }

    if (amount > rules.max_amount) {
      return toolResponse({
        status: "failed",
        message: `${category} expenses cannot exceed $${rules.max_amount}`,
        error: "amount_too_high",
        max_allowed: rules.max_amount,
        current_amount: amount,
        hint: "Amount exceeds category maximum. User may need to split expense or choose different category.",
      });
    }

    // TOOL CHECKS RECEIPT REQUIREMENT
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
          expense_category: category,
          supported_formats: ["image/jpeg", "image/png", "application/pdf"],
          max_size_mb: 10,
        },
        hint: "Ask user to provide receipt photo. After upload, retry submit_expense with receipt_url.",
        tell_user: "I'll need a photo or scan of the receipt to process this expense.",
      });
    }

    // TOOL CHECKS APPROVAL REQUIREMENT
    if (amount > rules.approval_required_over && !approval_id) {
      return toolResponse({
        status: "needs_approval",
        message: `${category} expenses over $${rules.approval_required_over} require manager approval`,
        category,
        amount,
        approval_threshold: rules.approval_required_over,
        next_action: "request_approval",
        next_action_params: {
          amount,
          category,
          description,
          receipt_url,
        },
        hint: "Request approval from manager. After approval, retry submit_expense with approval_id.",
        tell_user:
          "This expense needs manager approval. I'll send the request now, which typically takes 1-2 business days.",
      });
    }

    // TOOL CREATES THE EXPENSE
    const expense = await database.createExpense({
      amount,
      category,
      description,
      receipt_url,
      approval_id,
      status: "approved",
    });

    return toolResponse({
      status: "success",
      expense_id: expense.id,
      expense_number: expense.number,
      category,
      amount,
      message: `Expense ${expense.number} submitted successfully`,
      tell_user: `Your ${category} expense for $${amount.toFixed(2)} has been submitted and approved.`,
    });
  }
);

server.tool(
  "upload_receipt",
  "Upload a receipt image for an expense",
  {
    file_data: z.string().describe("Base64 encoded file data"),
    file_type: z.string().describe("File mime type (image/jpeg, image/png, application/pdf)"),
    expense_amount: z.number().optional().describe("Amount of the expense this receipt is for"),
    expense_category: z.string().optional().describe("Category of the expense"),
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
  "Request manager approval for an expense",
  {
    amount: z.number().describe("Expense amount"),
    category: z.string().describe("Expense category"),
    description: z.string().describe("Expense description"),
    receipt_url: z.string().optional().describe("Receipt URL if available"),
  },
  async ({ amount, category, description }) => {
    const approval = await database.createApproval({
      amount,
      category,
      description,
    });

    return toolResponse({
      status: "success",
      approval_id: approval.id,
      approval_status: approval.status,
      approver: approval.approver_name,
      message: `Approval request sent to ${approval.approver_name}`,
      next_action: "wait",
      hint: "Tell user the approval request has been sent. They should check back in 1-2 business days.",
      tell_user: `I've sent the approval request to ${approval.approver_name}. This typically takes 1-2 business days.`,
    });
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Tool-Heavy Expense Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
