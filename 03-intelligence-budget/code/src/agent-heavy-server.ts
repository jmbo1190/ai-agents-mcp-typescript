/**
 * Agent-Heavy Expense Server
 *
 * In this approach, the tool is minimal - just a database insert.
 * The agent must:
 * - Know all business rules
 * - Determine categories
 * - Check limits and thresholds
 * - Orchestrate the workflow
 *
 * Result: High token cost, potential for errors, but maximum flexibility
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { database, storage } from "./database.js";

const server = new McpServer({
  name: "expense-agent-heavy",
  version: "1.0.0",
});

// Agent-Heavy: Tool is just storage, no validation or business logic
server.tool(
  "submit_expense",
  "Submit an expense to the system. Agent must handle all validation and categorization.",
  {
    amount: z.number().describe("Expense amount in dollars"),
    category: z.string().describe("Expense category (meals, travel, supplies, etc)"),
    description: z.string().describe("What the expense was for"),
    receipt_url: z.string().optional().describe("URL to receipt image"),
    approval_id: z.string().optional().describe("Manager approval ID if required"),
  },
  async ({ amount, category, description, receipt_url, approval_id }) => {
    // Minimal validation - just store what we're given
    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    // Store the expense
    const expense = await database.createExpense({
      amount,
      category,
      description,
      receipt_url,
      approval_id,
      status: "submitted",
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              expense_id: expense.id,
              expense_number: expense.number,
              message: `Expense ${expense.number} submitted`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Agent needs helper tools to gather business rules
server.tool(
  "get_category_rules",
  "Get rules for all expense categories including limits and thresholds",
  {},
  async () => {
    const rules = database.getAllCategoryRules();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              categories: Object.entries(rules).map(([name, rules]) => ({
                name,
                max_amount: rules.max_amount,
                receipt_required_over: rules.receipt_required_over,
                approval_required_over: rules.approval_required_over,
              })),
              notes: [
                "Meals with clients should use 'client_entertainment' category",
                "Team events should use 'team_meals' category",
                "Always check receipt and approval requirements before submitting",
              ],
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "upload_receipt",
  "Upload a receipt image for an expense",
  {
    file_data: z.string().describe("Base64 encoded file data"),
    file_type: z.string().describe("File mime type (image/jpeg, image/png, application/pdf)"),
  },
  async ({ file_data, file_type }) => {
    // Simulate receipt upload
    const receipt = await storage.uploadReceipt(file_data, file_type);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              receipt_url: receipt.url,
              receipt_id: receipt.id,
            },
            null,
            2
          ),
        },
      ],
    };
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

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              approval_id: approval.id,
              approval_status: approval.status,
              approver: approval.approver_name,
              message: `Approval request sent to ${approval.approver_name}`,
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
  console.error("Agent-Heavy Expense Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
