/**
 * Self-Prompting Expense Server
 *
 * This server demonstrates SELF-PROMPTING - where tools make their own LLM calls
 * in isolated, focused contexts. The key insight: semantic reasoning doesn't have
 * to happen in the agent's crowded context just because it requires an LLM.
 *
 * When a tool makes an LLM call:
 * - The agent (which is an LLM) invokes the tool
 * - The tool constructs a FOCUSED prompt with only the relevant information
 * - The LLM responds in this isolated context (no conversation history!)
 * - The tool returns a result to the agent
 *
 * This pattern allows:
 * - Testable classification (same input = same output)
 * - Use of smaller/cheaper models for specific tasks
 * - Clean separation of concerns
 * - Predictable token costs
 *
 * Run with: npx tsx src/self-prompting-server.ts
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import OpenAI from "openai";
import { database, storage } from "./database.js";

// Initialize OpenAI client for self-prompting calls
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const server = new McpServer({
  name: "expense-self-prompting",
  version: "1.0.0",
});

interface ToolResult {
  status: "success" | "needs_receipt" | "needs_approval" | "needs_clarification" | "failed";
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

// ============================================================================
// SELF-PROMPTING: LLM calls INSIDE the tool
// ============================================================================

/**
 * This is the core self-prompting function. It makes an LLM call with:
 * - A FIXED, focused system prompt (same every time)
 * - Only the expense description and amount (no conversation history!)
 * - Temperature 0 for consistent results
 *
 * The agent never sees this reasoning. It just gets the result.
 */
async function classifyExpense(
  description: string,
  amount: number
): Promise<{
  category: string;
  confidence: number;
  reasoning: string;
}> {
  console.error(`[Self-Prompting] Classifying: "${description}" ($${amount})`);

  const response = await openai.responses.create({
    model: "gpt-4o-mini", // Can use smaller model for focused task!
    input: [
      {
        role: "user",
        content: `Expense description: "${description}"\nAmount: $${amount}`,
      },
    ],
    instructions: `You are an expense classifier. Your job is to categorize expenses into exactly one of these categories:

- meals: Regular meals, snacks, coffee (not with clients or at team events)
- client_entertainment: Meals, entertainment, or gifts for clients, customers, or prospects
- team_meals: Team lunches, celebrations, offsites, department meals
- travel: Flights, hotels, rental cars, trains, rideshares, parking
- supplies: Office supplies, equipment, furniture
- software: Software subscriptions, licenses, SaaS tools

Consider context clues carefully:
- Mentions of company names, "clients", "customers", "prospects" -> client_entertainment
- Mentions of "team", "department", "celebration", "offsite" -> team_meals
- Meal expenses without client/team indicators -> meals

Respond with JSON only:
{
  "category": "one of the categories above",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of why this category"
}`,
    temperature: 0, // Deterministic for testing
  });

  // Parse the response
  const text = response.output_text || "";

  try {
    // Extract JSON from response (handle potential markdown formatting)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      console.error(`[Self-Prompting] Result: ${result.category} (${result.confidence})`);
      return result;
    }
  } catch (e) {
    console.error(`[Self-Prompting] Parse error: ${e}`);
  }

  // Fallback if parsing fails
  return {
    category: "unknown",
    confidence: 0.3,
    reasoning: "Could not parse LLM response",
  };
}

/**
 * Layered classification: try cheap deterministic methods first,
 * fall back to self-prompting only when needed.
 */
async function classifyExpenseWithFallback(
  description: string,
  amount: number,
  contextHints?: {
    mentions_client?: boolean;
    mentions_team?: boolean;
  }
): Promise<{
  category: string;
  confidence: number;
  source: "deterministic" | "llm";
}> {
  // LAYER 1: Use context hints from the agent if available
  // These are FREE - no LLM call needed
  if (contextHints?.mentions_client) {
    const hasFood = /lunch|dinner|breakfast|meal|restaurant|coffee/i.test(description);
    if (hasFood) {
      console.error("[Classification] Using context hint: client meal");
      return {
        category: "client_entertainment",
        confidence: 0.95,
        source: "deterministic",
      };
    }
  }

  if (contextHints?.mentions_team) {
    const hasFood = /lunch|dinner|breakfast|meal|restaurant|coffee/i.test(description);
    if (hasFood) {
      console.error("[Classification] Using context hint: team meal");
      return {
        category: "team_meals",
        confidence: 0.95,
        source: "deterministic",
      };
    }
  }

  // LAYER 2: Keyword-based classification for OBVIOUS cases
  // These are FREE - no LLM call needed
  const lowerDesc = description.toLowerCase();

  if (/\b(flight|airline|hotel|airbnb|uber|lyft|taxi|rental car|train)\b/.test(lowerDesc)) {
    console.error("[Classification] Keyword match: travel");
    return { category: "travel", confidence: 0.95, source: "deterministic" };
  }

  if (/\b(software|subscription|license|saas|app)\b/.test(lowerDesc)) {
    console.error("[Classification] Keyword match: software");
    return { category: "software", confidence: 0.90, source: "deterministic" };
  }

  if (/\b(supplies|equipment|office|furniture|desk|chair)\b/.test(lowerDesc)) {
    console.error("[Classification] Keyword match: supplies");
    return { category: "supplies", confidence: 0.90, source: "deterministic" };
  }

  // LAYER 3: Self-prompting for AMBIGUOUS cases
  // This is where the LLM call happens - only when needed!
  console.error("[Classification] Falling back to LLM self-prompting");
  const llmResult = await classifyExpense(description, amount);

  return {
    category: llmResult.category,
    confidence: llmResult.confidence,
    source: "llm",
  };
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

server.tool(
  "submit_expense",
  `Submit an expense. The tool uses SELF-PROMPTING to classify ambiguous expenses -
making its own LLM call with a focused prompt, separate from the main conversation.`,
  {
    amount: z.number().describe("Expense amount in dollars"),
    description: z.string().describe("What was purchased or paid for"),
    context_hints: z
      .object({
        mentions_client: z.boolean().optional().describe("Did user mention a client?"),
        mentions_team: z.boolean().optional().describe("Did user mention team/department?"),
      })
      .optional()
      .describe("Hints from the conversation that help with classification"),
    receipt_url: z.string().optional().describe("URL to receipt if already uploaded"),
    approval_id: z.string().optional().describe("Manager approval ID if already obtained"),
  },
  async ({ amount, description, context_hints, receipt_url, approval_id }) => {
    // SELF-PROMPTING: Tool classifies the expense using its own LLM call
    const classification = await classifyExpenseWithFallback(description, amount, context_hints);

    console.error(`[Tool] Classification: ${classification.category} via ${classification.source}`);

    // Handle unknown category
    if (classification.category === "unknown") {
      return toolResponse({
        status: "needs_clarification",
        message: "Could not determine expense category",
        description_provided: description,
        classification_confidence: classification.confidence,
        hint: "The description is ambiguous. Ask user for more details about what type of expense this is.",
        tell_user:
          "I'm not sure how to categorize this expense. Could you tell me more about what it was for?",
      });
    }

    // Handle low confidence - ask for confirmation
    if (classification.confidence < 0.7) {
      return toolResponse({
        status: "needs_clarification",
        message: "Low confidence in category classification",
        suggested_category: classification.category,
        confidence: classification.confidence,
        classification_source: classification.source,
        hint: `The tool thinks this might be "${classification.category}" but isn't confident. Ask user to confirm.`,
        tell_user: `I think this is a ${classification.category} expense, but I'm not certain. Is that correct?`,
      });
    }

    const category = classification.category;

    // Apply business rules (deterministic code)
    const rules = database.getCategoryRules(category);

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
        hint: "Amount exceeds category maximum. User may need to split expense or recategorize.",
      });
    }

    // Check receipt requirement
    if (amount > rules.receipt_required_over && !receipt_url) {
      return toolResponse({
        status: "needs_receipt",
        message: `${category} expenses over $${rules.receipt_required_over} require a receipt`,
        category,
        amount,
        classification_source: classification.source,
        next_action: "upload_receipt",
        next_action_params: {
          expense_amount: amount,
          expense_category: category,
        },
        hint: "Ask user to provide receipt. After upload, retry submit_expense with receipt_url.",
        tell_user: `I've categorized this as ${category}. I'll need a receipt to complete the submission.`,
      });
    }

    // Check approval requirement
    if (amount > rules.approval_required_over && !approval_id) {
      return toolResponse({
        status: "needs_approval",
        message: `${category} expenses over $${rules.approval_required_over} require manager approval`,
        category,
        amount,
        classification_source: classification.source,
        next_action: "request_approval",
        next_action_params: {
          amount,
          category,
          description,
          receipt_url,
        },
        hint: "Request approval from manager. After approval, retry submit_expense with approval_id.",
        tell_user: `This ${category} expense needs manager approval. I'll send the request.`,
      });
    }

    // Create the expense
    const expense = await database.createExpense({
      amount,
      category,
      description,
      receipt_url,
      approval_id,
      status: "approved",
      metadata: {
        classification_source: classification.source,
        classification_confidence: classification.confidence,
      },
    });

    return toolResponse({
      status: "success",
      expense_id: expense.id,
      expense_number: expense.number,
      category,
      amount,
      classification_source: classification.source,
      message: `Expense ${expense.number} submitted successfully`,
      tell_user: `Your ${category} expense for $${amount.toFixed(2)} has been submitted.`,
    });
  }
);

server.tool(
  "upload_receipt",
  "Upload a receipt image for an expense",
  {
    file_data: z.string().describe("Base64 encoded file data"),
    file_type: z.string().describe("File mime type"),
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
    amount: z.number(),
    category: z.string(),
    description: z.string(),
    receipt_url: z.string().optional(),
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
      hint: "Tell user the approval request has been sent. Typical response time is 1-2 business days.",
      tell_user: `I've sent the approval request to ${approval.approver_name}. This typically takes 1-2 business days.`,
    });
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Self-Prompting Expense Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
