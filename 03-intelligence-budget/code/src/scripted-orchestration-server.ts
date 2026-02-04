/**
 * Scripted Orchestration Expense Server
 *
 * This server demonstrates SCRIPTED ORCHESTRATION - where agents write code that
 * orchestrates tools, rather than calling each tool step-by-step through the agent loop.
 *
 * The key insight: instead of the agent manually stepping through each operation and
 * looking at each result, it writes a script that does the stepping. The script runs
 * OUTSIDE the agent's context window, processes all data, and returns only the final result.
 *
 * Benefits:
 * - Dramatically more token-efficient (intermediate data never touches agent context)
 * - Deterministic (script does exactly what it says, every time)
 * - Faster (no round-trips through agent between tool calls)
 * - Enables parallel operations
 *
 * Run with: npx tsx src/scripted-orchestration-server.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import vm from "vm";
import { database, storage } from "./database.js";

const server = new McpServer({
  name: "expense-scripted-orchestration",
  version: "1.0.0",
});

interface ToolResult {
  status: "success" | "error";
  message: string;
  result?: unknown;
  error?: string;
  execution_time_ms?: number;
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
// Workflow Tools - Available to scripts via the `tools` object
// ============================================================================

/**
 * These are the tools that agent-written scripts can call.
 * They're wrapped versions of database operations.
 */
const workflowTools = {
  /**
   * Get all expenses for the current user
   */
  get_expenses: async (params?: { status?: string; category?: string; limit?: number }) => {
    console.error(`[Workflow] get_expenses(${JSON.stringify(params || {})})`);
    const expenses = database.getExpenses();

    let filtered = expenses;
    if (params?.status) {
      filtered = filtered.filter((e) => e.status === params.status);
    }
    if (params?.category) {
      filtered = filtered.filter((e) => e.category === params.category);
    }
    if (params?.limit) {
      filtered = filtered.slice(0, params.limit);
    }

    return filtered;
  },

  /**
   * Get a single expense by ID
   */
  get_expense: async (params: { expense_id: string }) => {
    console.error(`[Workflow] get_expense(${params.expense_id})`);
    return database.getExpense(params.expense_id);
  },

  /**
   * Create a new expense
   */
  create_expense: async (params: {
    amount: number;
    category: string;
    description: string;
    receipt_url?: string;
    approval_id?: string;
  }) => {
    console.error(`[Workflow] create_expense(${params.category}, $${params.amount})`);
    return database.createExpense({
      ...params,
      status: params.approval_id ? "approved" : "pending",
    });
  },

  /**
   * Get business rules for a category
   */
  get_category_rules: async (params: { category: string }) => {
    console.error(`[Workflow] get_category_rules(${params.category})`);
    return database.getCategoryRules(params.category);
  },

  /**
   * Get all category rules
   */
  get_all_category_rules: async () => {
    console.error(`[Workflow] get_all_category_rules()`);
    return database.getAllCategoryRules();
  },

  /**
   * Request approval for an expense
   */
  request_approval: async (params: { amount: number; category: string; description: string }) => {
    console.error(`[Workflow] request_approval(${params.category}, $${params.amount})`);
    return database.createApproval(params);
  },

  /**
   * Upload a receipt
   */
  upload_receipt: async (params: { file_data: string; file_type: string }) => {
    console.error(`[Workflow] upload_receipt(${params.file_type})`);
    return storage.uploadReceipt(params.file_data, params.file_type);
  },

  /**
   * Get expense statistics
   */
  get_expense_stats: async () => {
    console.error(`[Workflow] get_expense_stats()`);
    const expenses = database.getExpenses();

    const stats = {
      total_count: expenses.length,
      total_amount: expenses.reduce((sum, e) => sum + e.amount, 0),
      by_status: {} as Record<string, { count: number; amount: number }>,
      by_category: {} as Record<string, { count: number; amount: number }>,
    };

    for (const expense of expenses) {
      // By status
      if (!stats.by_status[expense.status]) {
        stats.by_status[expense.status] = { count: 0, amount: 0 };
      }
      stats.by_status[expense.status].count++;
      stats.by_status[expense.status].amount += expense.amount;

      // By category
      if (!stats.by_category[expense.category]) {
        stats.by_category[expense.category] = { count: 0, amount: 0 };
      }
      stats.by_category[expense.category].count++;
      stats.by_category[expense.category].amount += expense.amount;
    }

    return stats;
  },
};

// ============================================================================
// The execute_workflow Tool - Core of Scripted Orchestration
// ============================================================================

server.tool(
  "execute_workflow",
  `Execute a JavaScript workflow script. The script has access to a 'tools' object
with these async functions:

- tools.get_expenses({ status?, category?, limit? }) - Get expenses
- tools.get_expense({ expense_id }) - Get single expense
- tools.create_expense({ amount, category, description, receipt_url?, approval_id? }) - Create expense
- tools.get_category_rules({ category }) - Get rules for category
- tools.get_all_category_rules() - Get all category rules
- tools.request_approval({ amount, category, description }) - Request approval
- tools.upload_receipt({ file_data, file_type }) - Upload receipt
- tools.get_expense_stats() - Get expense statistics

The script runs in a sandbox with:
- Full async/await support
- Access to Date, Math, JSON, Array, Object, Promise
- 60 second timeout
- No access to filesystem, network, or process

Example workflow:
\`\`\`javascript
const expenses = await tools.get_expenses({ status: 'pending' });
const needsReceipt = expenses.filter(e => e.amount > 25 && !e.receipt_url);
return {
  pending_count: expenses.length,
  needs_receipt: needsReceipt.length,
  expenses_needing_receipt: needsReceipt.slice(0, 5)
};
\`\`\``,
  {
    code: z.string().describe("JavaScript code to execute. Must return a value."),
  },
  async ({ code }) => {
    console.error(`[Execute Workflow] Running script (${code.length} chars)`);
    const startTime = Date.now();

    // Create a sandbox with limited capabilities
    const sandbox = {
      // The workflow tools
      tools: workflowTools,

      // Safe built-ins
      Date,
      Math,
      JSON,
      Array,
      Object,
      Promise,
      console: {
        log: (...args: unknown[]) => console.error("[Script]", ...args),
        error: (...args: unknown[]) => console.error("[Script Error]", ...args),
      },

      // Block dangerous operations
      setTimeout: undefined,
      setInterval: undefined,
      fetch: undefined,
      require: undefined,
      process: undefined,
      eval: undefined,
      Function: undefined,
    };

    // Wrap the code in an async IIFE
    const wrappedCode = `
      (async () => {
        ${code}
      })()
    `;

    const context = vm.createContext(sandbox);

    try {
      const result = await vm.runInContext(wrappedCode, context, {
        timeout: 60000, // 60 second timeout
      });

      const executionTime = Date.now() - startTime;
      console.error(`[Execute Workflow] Completed in ${executionTime}ms`);

      return toolResponse({
        status: "success",
        message: "Workflow executed successfully",
        result,
        execution_time_ms: executionTime,
      });
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`[Execute Workflow] Error after ${executionTime}ms: ${error}`);

      return toolResponse({
        status: "error",
        message: "Workflow execution failed",
        error: error instanceof Error ? error.message : String(error),
        execution_time_ms: executionTime,
        hint: "Check the script for syntax errors or invalid tool calls.",
      });
    }
  }
);

// ============================================================================
// Additional Tools for Direct Use (non-workflow)
// ============================================================================

server.tool(
  "submit_expense",
  "Submit a single expense directly (for simple cases where a workflow isn't needed)",
  {
    amount: z.number().describe("Expense amount in dollars"),
    category: z
      .enum(["meals", "travel", "supplies", "software", "client_entertainment", "team_meals"])
      .describe("Expense category"),
    description: z.string().describe("What the expense was for"),
    receipt_url: z.string().optional().describe("URL to receipt"),
    approval_id: z.string().optional().describe("Manager approval ID"),
  },
  async ({ amount, category, description, receipt_url, approval_id }) => {
    const rules = database.getCategoryRules(category);

    // Validate
    if (amount <= 0) {
      return toolResponse({
        status: "error",
        message: "Amount must be greater than zero",
        error: "invalid_amount",
      });
    }

    if (amount > rules.max_amount) {
      return toolResponse({
        status: "error",
        message: `${category} expenses cannot exceed $${rules.max_amount}`,
        error: "amount_too_high",
      });
    }

    // Check requirements
    if (amount > rules.receipt_required_over && !receipt_url) {
      return toolResponse({
        status: "error",
        message: `${category} expenses over $${rules.receipt_required_over} require a receipt`,
        error: "needs_receipt",
      });
    }

    if (amount > rules.approval_required_over && !approval_id) {
      return toolResponse({
        status: "error",
        message: `${category} expenses over $${rules.approval_required_over} require approval`,
        error: "needs_approval",
      });
    }

    // Create expense
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
      message: `Expense ${expense.number} submitted`,
      expense_id: expense.id,
      expense_number: expense.number,
    });
  }
);

server.tool(
  "get_workflow_examples",
  "Get example workflow scripts for common tasks",
  {},
  async () => {
    const examples = [
      {
        name: "Summarize pending expenses",
        description: "Get a summary of all pending expenses by category",
        code: `
const expenses = await tools.get_expenses({ status: 'pending' });

const byCategory = {};
for (const e of expenses) {
  if (!byCategory[e.category]) {
    byCategory[e.category] = { count: 0, total: 0 };
  }
  byCategory[e.category].count++;
  byCategory[e.category].total += e.amount;
}

return {
  total_pending: expenses.length,
  total_amount: expenses.reduce((sum, e) => sum + e.amount, 0),
  by_category: byCategory
};`.trim(),
      },
      {
        name: "Find expenses needing receipts",
        description: "Find all expenses over the receipt threshold without receipts",
        code: `
const expenses = await tools.get_expenses();
const allRules = await tools.get_all_category_rules();

const needsReceipt = [];
for (const e of expenses) {
  const rules = allRules[e.category];
  if (e.amount > rules.receipt_required_over && !e.receipt_url) {
    needsReceipt.push({
      id: e.id,
      category: e.category,
      amount: e.amount,
      description: e.description
    });
  }
}

return {
  count: needsReceipt.length,
  expenses: needsReceipt
};`.trim(),
      },
      {
        name: "Batch expense submission",
        description: "Submit multiple small expenses at once",
        code: `
const expenses = [
  { amount: 12, category: 'meals', description: 'Coffee meeting' },
  { amount: 8, category: 'meals', description: 'Lunch snack' },
  { amount: 15, category: 'supplies', description: 'Notebooks' }
];

const results = [];
for (const e of expenses) {
  const created = await tools.create_expense(e);
  results.push({
    id: created.id,
    number: created.number,
    amount: e.amount
  });
}

return {
  submitted: results.length,
  expenses: results,
  total_amount: expenses.reduce((sum, e) => sum + e.amount, 0)
};`.trim(),
      },
      {
        name: "Expense analysis report",
        description: "Generate a comprehensive expense analysis",
        code: `
const stats = await tools.get_expense_stats();
const allRules = await tools.get_all_category_rules();

const analysis = {
  overview: {
    total_expenses: stats.total_count,
    total_spent: stats.total_amount
  },
  by_category: {},
  recommendations: []
};

for (const [category, data] of Object.entries(stats.by_category)) {
  const rules = allRules[category];
  const avgAmount = data.amount / data.count;

  analysis.by_category[category] = {
    count: data.count,
    total: data.amount,
    average: Math.round(avgAmount * 100) / 100,
    max_allowed: rules.max_amount
  };

  if (avgAmount > rules.max_amount * 0.8) {
    analysis.recommendations.push(
      category + ' expenses are averaging near the limit'
    );
  }
}

return analysis;`.trim(),
      },
    ];

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              message: "Example workflow scripts",
              examples,
              hint: "Copy and modify these scripts for your needs, then call execute_workflow with the code.",
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
  console.error("Scripted Orchestration Expense Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
