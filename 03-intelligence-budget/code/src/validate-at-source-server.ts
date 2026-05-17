/**
 * Validate at Source Expense Server
 *
 * This server demonstrates VALIDATE AT SOURCE - where validation happens in the tool,
 * including SEMANTIC validation using embedded LLM calls (self-prompting).
 *
 * The validation stack (from cheap to expensive):
 * 1. FORMAT VALIDATION: Schema/type checking (Zod) - FREE, instant
 * 2. BUSINESS RULES: Amount limits, date ranges - FREE, instant
 * 3. SEMANTIC VALIDATION: "Is this description meaningful?" - LLM call, ~1 second
 * 4. HUMAN REVIEW: Low-confidence cases flagged - Human time
 *
 * The key insight: just because validating "asdfasdf" requires understanding that
 * it's gibberish doesn't mean the AGENT needs to do that check. A self-prompted
 * LLM call in the tool can make that judgment.
 *
 * Run with: npx tsx src/validate-at-source-server.ts
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import OpenAI from "openai";
import { database, storage } from "./database.js";
import { load_api_keys } from './load_api_key.js';
await load_api_keys(); // Load API keys (if needed)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const server = new McpServer({
  name: "expense-validate-at-source",
  version: "1.0.0",
});

interface ToolResult {
  status: "success" | "rejected" | "needs_receipt" | "needs_approval" | "pending_review";
  validation_layer?: string;
  message: string;
  issues?: string[];
  suggestions?: string[];
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
// VALIDATION STACK - Layer 2: Business Rules (FREE)
// ============================================================================

interface BusinessValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

async function validateBusinessRules(
  amount: number,
  category: string,
  date?: string
): Promise<BusinessValidationResult> {
  console.error(`[Validation L2] Business rules for ${category}, $${amount}`);

  // Amount limits by category
  const categoryLimits: Record<string, number> = {
    meals: 100,
    team_meals: 500,
    client_entertainment: 300,
    travel: 5000,
    supplies: 500,
    software: 1000,
  };

  const maxAmount = categoryLimits[category] || 500;
  if (amount > maxAmount) {
    return {
      valid: false,
      error: `${category} expenses are limited to $${maxAmount}. This expense of $${amount} exceeds that limit.`,
    };
  }

  // Date validation (if provided)
  if (date) {
    const expenseDate = new Date(date);
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    if (expenseDate > now) {
      return {
        valid: false,
        error: "Expense date cannot be in the future.",
      };
    }

    if (expenseDate < ninetyDaysAgo) {
      return {
        valid: false,
        error: "Expenses older than 90 days cannot be submitted. Please contact finance for exceptions.",
      };
    }

    // Weekend client entertainment warning
    if (category === "client_entertainment") {
      const dayOfWeek = expenseDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return {
          valid: true,
          warning: "weekend_client_entertainment",
        };
      }
    }
  }

  return { valid: true };
}

// ============================================================================
// VALIDATION STACK - Layer 3: Semantic Validation (Self-Prompting)
// ============================================================================

interface SemanticValidationResult {
  valid: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
}

/**
 * Semantic validation uses SELF-PROMPTING to determine if the expense
 * description is meaningful and appropriate.
 *
 * This is where we catch:
 * - Gibberish like "asdfasdf"
 * - Vague descriptions like "stuff"
 * - Category mismatches like "dinner" under "software"
 * - Suspicious amounts like $500 for "coffee"
 */
async function validateSemantics(
  description: string,
  category: string,
  amount: number,
  flags?: { weekend_entertainment?: boolean }
): Promise<SemanticValidationResult> {
  console.error(`[Validation L3] Semantic check for "${description}"`);

  // QUICK DETERMINISTIC CHECKS (no LLM needed)
  // These catch obvious garbage before spending tokens

  // Check for gibberish patterns
  const gibberishPatterns = [
    /^[a-z]{5,}$/i, // Random letters like "asdfgh"
    /^[\d\s]+$/, // Just numbers and spaces
    /(.)\1{4,}/, // Repeated characters like "aaaaa"
    /^test$/i, // Test entries
    /^xxx+$/i, // Placeholder
  ];

  if (gibberishPatterns.some((p) => p.test(description.trim()))) {
    console.error(`[Validation L3] Gibberish detected (pattern match)`);
    return {
      valid: false,
      confidence: 0.95,
      issues: ["Description appears to be placeholder or test text"],
      suggestions: ["Provide a meaningful description of what this expense was for"],
    };
  }

  // Check minimum meaningful content
  const words = description.trim().split(/\s+/);
  if (words.length < 2) {
    console.error(`[Validation L3] Too brief (${words.length} words)`);
    return {
      valid: false,
      confidence: 0.9,
      issues: ["Description is too brief for audit purposes"],
      suggestions: ["Include what the expense was for and any relevant context"],
    };
  }

  // FOR GENUINELY AMBIGUOUS CASES: Use self-prompting
  console.error(`[Validation L3] Using LLM for semantic check`);

  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    input: [
      {
        role: "user",
        content: `Category: ${category}
Amount: $${amount}
Description: "${description}"
${flags?.weekend_entertainment ? "Note: This is weekend client entertainment." : ""}`,
      },
    ],
    instructions: `You validate expense report descriptions. Check for:

1. MEANINGFULNESS: Is this a real expense description or placeholder text?
   - "asdfgh" = NOT meaningful
   - "Lunch at downtown cafe" = meaningful

2. CATEGORY MATCH: Does the description match the stated category?
   - meals: Food purchases for individual work meals
   - client_entertainment: Meals/events with clients, customers, prospects
   - team_meals: Team lunches, celebrations, department events
   - travel: Transportation, lodging, related expenses
   - supplies: Office supplies and equipment
   - software: Software subscriptions and licenses

3. REASONABLENESS: Is the amount reasonable for what's described?
   - $500 coffee -> suspicious
   - $15 lunch -> reasonable
   - $200 team dinner for 10 people -> reasonable

4. POLICY FLAGS: Any concerns?
   - Mentions of alcohol in large amounts
   - Luxury items not clearly justified
   - Vague descriptions for large amounts

Respond with JSON only:
{
  "valid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["list of problems, empty array if valid"],
  "suggestions": ["how to fix, empty array if valid"]
}`,
    temperature: 0,
  });

  // Parse response
  const text = response.output_text || "";
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      console.error(`[Validation L3] LLM result: valid=${result.valid}, confidence=${result.confidence}`);
      return {
        valid: result.valid ?? true,
        confidence: result.confidence ?? 0.8,
        issues: result.issues ?? [],
        suggestions: result.suggestions ?? [],
      };
    }
  } catch (e) {
    console.error(`[Validation L3] Parse error: ${e}`);
  }

  // Fallback: assume valid if LLM response is unparseable
  return {
    valid: true,
    confidence: 0.6,
    issues: [],
    suggestions: [],
  };
}

// ============================================================================
// MCP Tool with Full Validation Stack
// ============================================================================

server.tool(
  "submit_expense",
  `Submit an expense with comprehensive validation.

The tool validates at multiple layers:
1. FORMAT: Schema validation (automatic via Zod)
2. BUSINESS RULES: Amount limits, date ranges
3. SEMANTIC: Is the description meaningful? Does it match the category?
4. HUMAN REVIEW: Low-confidence cases are flagged

The agent never needs to validate - the tool handles everything and returns
either success or a clear error with guidance.`,
  {
    amount: z.number().positive("Amount must be positive"),
    description: z.string().min(1, "Description required").max(500, "Description too long"),
    category: z.enum(["meals", "travel", "supplies", "software", "client_entertainment", "team_meals"]),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
      .optional(),
    receipt_url: z.string().url().optional(),
    approval_id: z.string().optional(),
  },
  async ({ amount, description, category, date, receipt_url, approval_id }) => {
    console.error(`\n[Submit] Starting validation for $${amount} ${category}`);

    // LAYER 1: Format validation already happened via Zod schema
    console.error(`[Validation L1] Format: PASSED (Zod)`);

    // LAYER 2: Business rules
    const businessCheck = await validateBusinessRules(amount, category, date);

    if (!businessCheck.valid) {
      console.error(`[Validation L2] Business rules: FAILED`);
      return toolResponse({
        status: "rejected",
        validation_layer: "business_rules",
        message: businessCheck.error!,
        tell_user: businessCheck.error!,
      });
    }
    console.error(`[Validation L2] Business rules: PASSED`);

    // LAYER 3: Semantic validation
    const semanticCheck = await validateSemantics(description, category, amount, {
      weekend_entertainment: businessCheck.warning === "weekend_client_entertainment",
    });

    if (!semanticCheck.valid) {
      console.error(`[Validation L3] Semantic: REJECTED`);
      return toolResponse({
        status: "rejected",
        validation_layer: "semantic",
        message: "Description validation failed",
        issues: semanticCheck.issues,
        suggestions: semanticCheck.suggestions,
        tell_user: semanticCheck.issues.join(" ") + " " + semanticCheck.suggestions.join(" "),
      });
    }
    console.error(`[Validation L3] Semantic: PASSED (confidence: ${semanticCheck.confidence})`);

    // LAYER 4: Flag low-confidence for human review
    if (semanticCheck.confidence < 0.75) {
      console.error(`[Validation L4] Flagging for human review (low confidence)`);

      const expense = await database.createExpense({
        amount,
        category,
        description,
        receipt_url,
        approval_id,
        status: "pending_review",
        metadata: {
          review_reason: "low_validation_confidence",
          validation_confidence: semanticCheck.confidence,
        },
      });

      return toolResponse({
        status: "pending_review",
        validation_layer: "human_review",
        expense_id: expense.id,
        expense_number: expense.number,
        confidence: semanticCheck.confidence,
        message: "Expense submitted but flagged for manual review",
        tell_user:
          "I've submitted your expense, but it's been flagged for manual review due to some uncertainty. You'll be notified once it's processed.",
      });
    }

    // ALL VALIDATION PASSED - Check operational requirements
    const rules = database.getCategoryRules(category);

    // Need receipt?
    if (amount > rules.receipt_required_over && !receipt_url) {
      return toolResponse({
        status: "needs_receipt",
        validation_layer: "passed",
        category,
        amount,
        message: `${category} expenses over $${rules.receipt_required_over} require a receipt`,
        next_action: "upload_receipt",
        next_action_params: {
          expense_amount: amount,
          expense_category: category,
        },
        tell_user: `Validation passed! This ${category} expense of $${amount} requires a receipt. Please upload one to complete the submission.`,
      });
    }

    // Need approval?
    if (amount > rules.approval_required_over && !approval_id) {
      return toolResponse({
        status: "needs_approval",
        validation_layer: "passed",
        category,
        amount,
        message: `${category} expenses over $${rules.approval_required_over} require approval`,
        next_action: "request_approval",
        next_action_params: {
          amount,
          category,
          description,
          receipt_url,
        },
        tell_user: `Validation passed! This ${category} expense needs manager approval.`,
      });
    }

    // CREATE THE EXPENSE
    const expense = await database.createExpense({
      amount,
      category,
      description,
      date,
      receipt_url,
      approval_id,
      status: "approved",
      metadata: {
        validation_confidence: semanticCheck.confidence,
      },
    });

    console.error(`[Submit] SUCCESS: ${expense.number}`);

    return toolResponse({
      status: "success",
      validation_layer: "all_passed",
      expense_id: expense.id,
      expense_number: expense.number,
      category,
      amount,
      validation_confidence: semanticCheck.confidence,
      message: `Expense ${expense.number} submitted successfully`,
      tell_user: `Your ${category} expense of $${amount} has been validated and submitted.`,
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
      message: "Receipt uploaded successfully",
      receipt_url: receipt.url,
      receipt_id: receipt.id,
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
      message: `Approval request sent to ${approval.approver_name}`,
      approval_id: approval.id,
      approval_status: approval.status,
      approver: approval.approver_name,
      next_action: "wait",
      hint: "Tell user the approval request has been sent.",
      tell_user: `I've sent the approval request to ${approval.approver_name}. This typically takes 1-2 business days.`,
    });
  }
);

// ============================================================================
// Demo Tool: Test Validation
// ============================================================================

server.tool(
  "test_validation",
  `Test the validation stack with sample descriptions.
Returns how each description would be validated without actually creating expenses.`,
  {
    descriptions: z.array(z.string()).describe("List of descriptions to test"),
    category: z.enum(["meals", "travel", "supplies", "software", "client_entertainment", "team_meals"]),
    amount: z.number(),
  },
  async ({ descriptions, category, amount }) => {
    const results = [];

    for (const desc of descriptions) {
      console.error(`\n[Test] Validating: "${desc}"`);

      // Business rules (always pass for this test)
      const businessResult = await validateBusinessRules(amount, category);

      // Semantic validation
      const semanticResult = await validateSemantics(desc, category, amount);

      results.push({
        description: desc,
        business_valid: businessResult.valid,
        semantic_valid: semanticResult.valid,
        confidence: semanticResult.confidence,
        issues: semanticResult.issues,
        suggestions: semanticResult.suggestions,
        would_be_flagged: semanticResult.confidence < 0.75,
      });
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              category,
              amount,
              results,
              summary: {
                tested: results.length,
                would_pass: results.filter((r) => r.semantic_valid && !r.would_be_flagged).length,
                would_be_flagged: results.filter((r) => r.would_be_flagged).length,
                would_fail: results.filter((r) => !r.semantic_valid).length,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Validate at Source Expense Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
