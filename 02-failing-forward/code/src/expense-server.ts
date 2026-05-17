/**
 * Failing Forward Expense Server
 *
 * Demonstrates all four Failing Forward patterns:
 * 1. Errors as Curriculum - Teaching errors that guide recovery
 * 2. Error Chains - Multi-step recovery processes
 * 3. Pre-filled Parameters - Handing agents everything they need
 * 4. Alternative Actions - Multiple paths to success
 *
 * Run with: npx tsx src/expense-server.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "expense-server",
  version: "1.0.0",
});

// ============================================================================
// Mock Database
// ============================================================================

interface Expense {
  id: string;
  amount: number;
  category: string;
  description: string;
  receipt_url?: string;
  date: string;
  status: string;
  created_at: Date;
}

interface Receipt {
  id: string;
  url: string;
  expense_amount: number;
  uploaded_at: Date;
}

interface Approval {
  id: string;
  expense_id?: string;
  type: string;
  status: "pending" | "approved" | "denied";
  approver: string;
  created_at: Date;
}

class MockDatabase {
  private readonly expenses: Map<string, Expense> = new Map();
  private readonly receipts: Map<string, Receipt> = new Map();
  private readonly approvals: Map<string, Approval> = new Map();
  private expenseCounter = 1;
  private receiptCounter = 1;
  private approvalCounter = 1;

  async createExpense(data: Omit<Expense, "id" | "created_at" | "status">): Promise<Expense> {
    const id = `exp_${this.expenseCounter++}`;
    const expense: Expense = {
      ...data,
      id,
      status: "pending_approval",
      created_at: new Date(),
    };
    this.expenses.set(id, expense);
    return expense;
  }

  async createReceipt(data: { expense_amount: number }): Promise<Receipt> {
    const id = `rcpt_${this.receiptCounter++}`;
    const receipt: Receipt = {
      id,
      url: `https://storage.example.com/receipts/${id}.jpg`,
      expense_amount: data.expense_amount,
      uploaded_at: new Date(),
    };
    this.receipts.set(id, receipt);
    return receipt;
  }

  async createApproval(data: { type: string; expense_id?: string }): Promise<Approval> {
    const id = `apr_${this.approvalCounter++}`;
    const approval: Approval = {
      id,
      expense_id: data.expense_id,
      type: data.type,
      status: "pending",
      approver: data.type === "late_expense" ? "finance-manager@company.com" : "manager@company.com",
      created_at: new Date(),
    };
    this.approvals.set(id, approval);
    return approval;
  }

  async getApproval(id: string): Promise<Approval | undefined> {
    return this.approvals.get(id);
  }
}

const database = new MockDatabase();

// ============================================================================
// Structured Response Helpers
// ============================================================================

interface ToolResult {
  status: "success" | "failed" | "needs_action" | "needs_clarification";
  error?: string;
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

// ============================================================================
// Constants
// ============================================================================

const VALID_CATEGORIES = ["meals", "travel", "supplies", "software", "equipment"];
const RECEIPT_THRESHOLD = 25;
const APPROVAL_THRESHOLD = 100;
const LATE_EXPENSE_DAYS = 90;

// ============================================================================
// Tool 1: Submit Expense (Main tool demonstrating all patterns)
// ============================================================================

server.registerTool(
  "submit_expense",
  {
    description: `Submit an expense for reimbursement.

This tool demonstrates the Failing Forward pattern - errors guide recovery.

IMPORTANT: This tool will return structured errors with next_action when:
- Receipt is required but not provided (expenses over $${RECEIPT_THRESHOLD})
- Category is invalid
- Date is in the future
- Expense is too old (over ${LATE_EXPENSE_DAYS} days)
- Amount exceeds approval threshold ($${APPROVAL_THRESHOLD}+)

Always check the status field in the response and follow the next_action if provided.`,
    inputSchema: z.object({
      amount: z.number().describe("Expense amount in USD"),
      category: z.string().describe(`One of: ${VALID_CATEGORIES.join(", ")}`),
      description: z.string().describe("Brief description of the expense"),
      date: z.string().describe("Date of expense in YYYY-MM-DD format"),
      receipt_url: z.string().optional().describe("URL to receipt image (required for expenses over $25)"),
      approval_id: z.string().optional().describe("Approval ID for expenses over $100 or late expenses"),
    }),
  },
  async ({ amount, category, description, date, receipt_url, approval_id }) => {
    // ========================================================================
    // Validation 1: Amount must be positive
    // ========================================================================
    if (amount <= 0) {
      return toolResponse({
        status: "failed",
        error: "invalid_amount",
        message: "Expense amount must be greater than zero",
        next_action: "resubmit",
        hint: "Check that the amount is positive. The user may have entered it incorrectly.",
        tell_user: "The expense amount must be greater than zero. Could you confirm the amount?",
      });
    }

    // ========================================================================
    // Validation 2: Date cannot be in the future
    // ========================================================================
    const expenseDate = new Date(date);
    const today = new Date();
    expenseDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    if (expenseDate > today) {
      return toolResponse({
        status: "failed",
        error: "future_date",
        message: `Expense date ${date} is in the future. Expenses must be dated today or earlier.`,
        next_action: "resubmit",
        next_action_params: {
          suggested_date: today.toISOString().split("T")[0],
        },
        hint: "Ask the user to confirm the correct date. They may have made a typo.",
        tell_user: "The expense date appears to be in the future. Could you confirm the correct date?",
      });
    }

    // ========================================================================
    // Validation 3: Check if expense is too old (needs special approval)
    // ========================================================================
    const daysSinceExpense = Math.floor((today.getTime() - expenseDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceExpense > LATE_EXPENSE_DAYS && !approval_id) {
      return toolResponse({
        status: "needs_action",
        error: "late_expense",
        message: `This expense is ${daysSinceExpense} days old, which exceeds the ${LATE_EXPENSE_DAYS}-day limit.`,
        next_action: "request_late_expense_approval",
        next_action_params: {
          expense_date: date,
          days_late: daysSinceExpense - LATE_EXPENSE_DAYS,
          amount,
          category,
          description,
          reason_required: true,
        },
        alternative_actions: [
          {
            action: "request_late_expense_approval",
            description: "Request special approval for the late expense",
            when_to_use: "When the expense is legitimate but was submitted late",
            params: {
              expense_date: date,
              days_late: daysSinceExpense - LATE_EXPENSE_DAYS,
            },
          },
          {
            action: "cancel",
            description: "Cancel the expense submission",
            when_to_use: "When the user decides not to submit the old expense",
          },
        ],
        hint: `This expense is ${daysSinceExpense - LATE_EXPENSE_DAYS} days past the submission deadline. Ask the user why it was submitted late and whether they want to request special approval.`,
        tell_user: `This expense is over ${LATE_EXPENSE_DAYS} days old and requires special approval. Would you like me to request approval from finance? I'll need a brief explanation for why it's being submitted late.`,
      });
    }

    // ========================================================================
    // Validation 4: Category must be valid
    // ========================================================================
    if (!VALID_CATEGORIES.includes(category.toLowerCase())) {
      // PATTERN: Pre-filled parameters - suggest the best match
      const suggestions = VALID_CATEGORIES.filter((c) => c.includes(category.toLowerCase().substring(0, 3)) || category.toLowerCase().includes(c.substring(0, 3)));

      return toolResponse({
        status: "failed",
        error: "invalid_category",
        message: `Category '${category}' is not recognized.`,
        valid_options: VALID_CATEGORIES,
        suggested_category: suggestions.length > 0 ? suggestions[0] : undefined,
        next_action: "resubmit",
        next_action_params: {
          amount,
          description,
          date,
          receipt_url,
          category: suggestions.length > 0 ? suggestions[0] : undefined,
        },
        hint: `The user said '${category}'. Map this to one of: ${VALID_CATEGORIES.join(", ")}. ${suggestions.length > 0 ? `'${suggestions[0]}' seems like the best match.` : "Ask user to clarify if unclear."}`,
        tell_user: `I don't recognize the category '${category}'. Valid options are: ${VALID_CATEGORIES.join(", ")}. Which one should I use?`,
      });
    }

    // Normalize category to lowercase
    const normalizedCategory = category.toLowerCase();

    // ========================================================================
    // Validation 5: Receipt required for expenses over $25
    // ========================================================================
    if (amount > RECEIPT_THRESHOLD && !receipt_url) {
      return toolResponse({
        status: "needs_action",
        error: "receipt_required",
        message: `Expenses over $${RECEIPT_THRESHOLD} require a receipt. This expense is $${amount.toFixed(2)}.`,
        next_action: "upload_receipt",
        next_action_params: {
          expense_amount: amount,
          expense_category: normalizedCategory,
          expense_description: description,
          expense_date: date,
          supported_formats: ["image/jpeg", "image/png", "application/pdf"],
          max_size_mb: 10,
        },
        hint: "Ask the user to provide a photo or scan of the receipt. Once uploaded, retry submit_expense with the receipt_url.",
        tell_user: `Since this expense is over $${RECEIPT_THRESHOLD}, I'll need a photo or scan of the receipt. Could you upload it?`,
      });
    }

    // ========================================================================
    // Validation 6: Large expenses need manager approval
    // ========================================================================
    if (amount > APPROVAL_THRESHOLD && !approval_id) {
      return toolResponse({
        status: "needs_action",
        error: "approval_required",
        message: `Expenses over $${APPROVAL_THRESHOLD} require manager approval. This expense is $${amount.toFixed(2)}.`,
        next_action: "request_expense_approval",
        next_action_params: {
          amount,
          category: normalizedCategory,
          description,
          date,
          receipt_url,
        },
        hint: "Large expenses need approval before submission. Request approval and then retry with the approval_id.",
        tell_user: `This expense of $${amount.toFixed(2)} needs manager approval. I'll send the request now.`,
      });
    }

    // ========================================================================
    // Success! Create the expense
    // ========================================================================
    const expense = await database.createExpense({
      amount,
      category: normalizedCategory,
      description,
      date,
      receipt_url,
    });

    return toolResponse({
      status: "success",
      expense_id: expense.id,
      message: `Expense submitted for $${amount.toFixed(2)} in ${normalizedCategory}`,
      current_status: expense.status,
      tell_user: `Your expense for $${amount.toFixed(2)} has been submitted successfully and is pending approval.`,
    });
  }
);

// ============================================================================
// Tool 2: Upload Receipt
// ============================================================================

server.registerTool(
  "upload_receipt",
  {
    description: `Upload a receipt image for an expense.

Returns a receipt_url that can be used with submit_expense.
This is typically called after submit_expense returns a receipt_required error.`,
    inputSchema: z.object({
      expense_amount: z.number().describe("The amount of the expense this receipt is for"),
      file_data: z.string().optional().describe("Base64 encoded file data (simulated in this example)"),
      file_type: z.string().optional().describe("File mime type: image/jpeg, image/png, or application/pdf"),
    }),
  },
  async ({ expense_amount, file_type }) => {
    // Validate file type if provided
    const validTypes = ["image/jpeg", "image/png", "application/pdf"];
    if (file_type && !validTypes.includes(file_type)) {
      return toolResponse({
        status: "failed",
        error: "invalid_file_type",
        message: `File type '${file_type}' is not supported.`,
        valid_types: validTypes,
        next_action: "upload_receipt",
        hint: "Ask the user to provide a JPEG, PNG, or PDF file.",
        tell_user: "The receipt must be a JPEG, PNG, or PDF file. Could you provide it in one of those formats?",
      });
    }

    // Create the receipt
    const receipt = await database.createReceipt({ expense_amount });

    return toolResponse({
      status: "success",
      receipt_id: receipt.id,
      receipt_url: receipt.url,
      message: "Receipt uploaded successfully",
      next_action: "submit_expense",
      next_action_params: {
        receipt_url: receipt.url,
      },
      hint: "Now retry submit_expense with this receipt_url",
      tell_user: "Receipt uploaded! I'll now submit the expense.",
    });
  }
);

// ============================================================================
// Tool 3: Request Expense Approval (for large expenses)
// ============================================================================

server.registerTool(
  "request_expense_approval",
  {
    description: `Request manager approval for a large expense (over $${APPROVAL_THRESHOLD}).

Returns an approval_id that can be used with submit_expense.
In a real system, this would send a notification to the manager.`,
    inputSchema: z.object({
      amount: z.number().describe("Expense amount"),
      category: z.string().describe("Expense category"),
      description: z.string().describe("Expense description"),
      date: z.string().describe("Expense date"),
      receipt_url: z.string().optional().describe("Receipt URL if already uploaded"),
    }),
  },
  async ({ amount, category, description, date, receipt_url }) => {
    const approval = await database.createApproval({
      type: "large_expense",
    });

    // In a real system, this would be async and require waiting
    // For demo purposes, we'll auto-approve
    return toolResponse({
      status: "success",
      approval_id: approval.id,
      approval_status: "approved", // Simulated instant approval for demo
      approver: approval.approver,
      message: `Approval request sent to ${approval.approver}`,
      next_action: "submit_expense",
      next_action_params: {
        amount,
        category,
        description,
        date,
        receipt_url,
        approval_id: approval.id,
      },
      hint: "Approval granted. Now retry submit_expense with the approval_id.",
      tell_user: `Your expense has been approved by ${approval.approver}. Submitting now...`,
    });
  }
);

// ============================================================================
// Tool 4: Request Late Expense Approval (for old expenses)
// ============================================================================

server.registerTool(
  "request_late_expense_approval",
  {
    description: `Request special approval for an expense that's over ${LATE_EXPENSE_DAYS} days old.

Requires a reason for why the expense is being submitted late.
Returns an approval_id that can be used with submit_expense.`,
    inputSchema: z.object({
      expense_date: z.string().describe("Original date of the expense"),
      days_late: z.number().describe("Number of days past the submission deadline"),
      amount: z.number().describe("Expense amount"),
      category: z.string().describe("Expense category"),
      description: z.string().describe("Expense description"),
      late_reason: z.string().describe("Explanation for why the expense is being submitted late"),
    }),
  },
  async ({ expense_date, days_late, amount, category, description, late_reason }) => {
    // Validate that a reason was provided
    if (!late_reason || late_reason.trim().length < 10) {
      return toolResponse({
        status: "failed",
        error: "reason_required",
        message: "A detailed explanation is required for late expense submissions.",
        next_action: "request_late_expense_approval",
        next_action_params: {
          expense_date,
          days_late,
          amount,
          category,
          description,
        },
        hint: "Ask the user to provide a reason for the late submission. It should be at least a sentence explaining the circumstances.",
        tell_user: "I need a brief explanation for why this expense is being submitted late. What happened?",
      });
    }

    const approval = await database.createApproval({
      type: "late_expense",
    });

    return toolResponse({
      status: "success",
      approval_id: approval.id,
      approval_status: "approved", // Simulated for demo
      approver: approval.approver,
      message: `Late expense approval granted by ${approval.approver}`,
      reason_recorded: late_reason,
      next_action: "submit_expense",
      next_action_params: {
        amount,
        category,
        description,
        date: expense_date,
        approval_id: approval.id,
      },
      hint: "Late expense approved. Now retry submit_expense with the approval_id.",
      tell_user: `The late expense has been approved. Submitting now...`,
    });
  }
);

// ============================================================================
// Tool 5: Get Category Suggestions (helper tool)
// ============================================================================

server.registerTool(
  "get_expense_categories",
  {
    description: "Get the list of valid expense categories with descriptions",
  },
  async () => {
    const categories = [
      { name: "meals", description: "Food and beverages for business purposes", examples: ["lunch meetings", "team dinners", "client meals"] },
      { name: "travel", description: "Transportation and lodging", examples: ["flights", "hotels", "rental cars", "uber/taxi"] },
      { name: "supplies", description: "Office and work supplies", examples: ["notebooks", "pens", "desk accessories"] },
      { name: "software", description: "Software subscriptions and licenses", examples: ["SaaS tools", "annual licenses", "cloud services"] },
      { name: "equipment", description: "Hardware and equipment", examples: ["monitors", "keyboards", "headsets"] },
    ];

    return toolResponse({
      status: "success",
      categories,
      receipt_threshold: RECEIPT_THRESHOLD,
      approval_threshold: APPROVAL_THRESHOLD,
      late_expense_days: LATE_EXPENSE_DAYS,
      message: "Here are the valid expense categories and their rules",
    });
  }
);

// ============================================================================
// Start the server
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Failing Forward Expense Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
