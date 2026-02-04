/**
 * Failing Forward - Server Demo
 *
 * This script demonstrates the Failing Forward pattern by making direct
 * tool calls and showing the structured responses.
 *
 * The key insight: the tool responses contain everything an agent needs
 * to recover from errors - next_action, next_action_params, hints, etc.
 *
 * Run with: npm test
 */

import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ============================================================================
// Helpers
// ============================================================================

function getResultText(result: any): string {
  if (!result.content?.length) return "(no output)";
  return result.content.map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
}

function parseResult(result: any): any {
  return JSON.parse(getResultText(result));
}

// ============================================================================
// Main Demo
// ============================================================================

async function runDemo() {
  console.log("\n" + "=".repeat(70));
  console.log("FAILING FORWARD PATTERN - SERVER DEMO");
  console.log("=".repeat(70));
  console.log("\nThis demo shows how tool responses guide agent behavior.");
  console.log("Notice how each error response includes next_action and hints.\n");

  // Connect to the expense server
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/expense-server.ts"],
  });

  const client = new Client({ name: "demo-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  console.log("Connected to Expense Server\n");

  // ========================================================================
  // Demo 1: Receipt Required
  // ========================================================================
  console.log("=".repeat(70));
  console.log("DEMO 1: Receipt Required Error");
  console.log("=".repeat(70));
  console.log("\nSubmitting a $75 expense WITHOUT a receipt...\n");

  const demo1 = await client.callTool({
    name: "submit_expense",
    arguments: {
      amount: 75,
      category: "meals",
      description: "Team lunch at downtown cafe",
      date: new Date().toISOString().split("T")[0],
    },
  });
  const demo1Result = parseResult(demo1);

  console.log("TOOL RESPONSE:");
  console.log(JSON.stringify(demo1Result, null, 2));
  console.log("\n📌 KEY INSIGHT: The response tells the agent exactly what to do next:");
  console.log(`   - next_action: "${demo1Result.next_action}"`);
  console.log(`   - hint: "${demo1Result.hint}"`);
  console.log(`   - Pre-filled params include supported formats and size limits`);

  // ========================================================================
  // Demo 2: Invalid Category
  // ========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("DEMO 2: Invalid Category Error");
  console.log("=".repeat(70));
  console.log("\nSubmitting with category 'food' instead of 'meals'...\n");

  const demo2 = await client.callTool({
    name: "submit_expense",
    arguments: {
      amount: 20,
      category: "food",
      description: "Quick lunch",
      date: new Date().toISOString().split("T")[0],
    },
  });
  const demo2Result = parseResult(demo2);

  console.log("TOOL RESPONSE:");
  console.log(JSON.stringify(demo2Result, null, 2));
  console.log("\n📌 KEY INSIGHT: The response provides valid options and a hint:");
  console.log(`   - valid_options: ${JSON.stringify(demo2Result.valid_options)}`);
  console.log(`   - hint: "${demo2Result.hint}"`);

  // ========================================================================
  // Demo 3: Large Expense Needs Approval
  // ========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("DEMO 3: Approval Required for Large Expense");
  console.log("=".repeat(70));
  console.log("\nSubmitting a $200 expense (over approval threshold)...\n");

  const demo3 = await client.callTool({
    name: "submit_expense",
    arguments: {
      amount: 200,
      category: "meals",
      description: "Client dinner",
      date: new Date().toISOString().split("T")[0],
      receipt_url: "https://example.com/receipt.jpg",
    },
  });
  const demo3Result = parseResult(demo3);

  console.log("TOOL RESPONSE:");
  console.log(JSON.stringify(demo3Result, null, 2));
  console.log("\n📌 KEY INSIGHT: The response guides to the approval flow:");
  console.log(`   - next_action: "${demo3Result.next_action}"`);
  console.log(`   - Pre-filled params preserve all the expense details`);

  // ========================================================================
  // Demo 4: Following the Recovery Flow
  // ========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("DEMO 4: Complete Recovery Flow");
  console.log("=".repeat(70));
  console.log("\nWatch how the tool responses chain together:\n");

  // Step 1: Submit without receipt
  console.log("Step 1: Submit $50 expense (no receipt)");
  const step1 = await client.callTool({
    name: "submit_expense",
    arguments: {
      amount: 50,
      category: "meals",
      description: "Business lunch",
      date: new Date().toISOString().split("T")[0],
    },
  });
  const step1Result = parseResult(step1);
  console.log(`   Status: ${step1Result.status} (${step1Result.error})`);
  console.log(`   Next action: ${step1Result.next_action}`);

  // Step 2: Upload receipt
  console.log("\nStep 2: Upload receipt (following the guidance)");
  const step2 = await client.callTool({
    name: "upload_receipt",
    arguments: {
      expense_amount: 50,
      file_type: "image/jpeg",
    },
  });
  const step2Result = parseResult(step2);
  console.log(`   Status: ${step2Result.status}`);
  console.log(`   Receipt URL: ${step2Result.receipt_url}`);
  console.log(`   Next action: ${step2Result.next_action}`);

  // Step 3: Resubmit with receipt
  console.log("\nStep 3: Resubmit with receipt URL");
  const step3 = await client.callTool({
    name: "submit_expense",
    arguments: {
      amount: 50,
      category: "meals",
      description: "Business lunch",
      date: new Date().toISOString().split("T")[0],
      receipt_url: step2Result.receipt_url,
    },
  });
  const step3Result = parseResult(step3);
  console.log(`   Status: ${step3Result.status}`);
  console.log(`   Expense ID: ${step3Result.expense_id}`);
  console.log(`   Message: ${step3Result.message}`);

  console.log("\n📌 KEY INSIGHT: The agent never needed special instructions.");
  console.log("   The tool responses guided the entire recovery flow.\n");

  // ========================================================================
  // Demo 5: Successful Small Expense
  // ========================================================================
  console.log("=".repeat(70));
  console.log("DEMO 5: Successful Small Expense (No Issues)");
  console.log("=".repeat(70));
  console.log("\nSubmitting a $15 expense (under receipt threshold)...\n");

  const demo5 = await client.callTool({
    name: "submit_expense",
    arguments: {
      amount: 15,
      category: "meals",
      description: "Coffee meeting",
      date: new Date().toISOString().split("T")[0],
    },
  });
  const demo5Result = parseResult(demo5);

  console.log("TOOL RESPONSE:");
  console.log(JSON.stringify(demo5Result, null, 2));
  console.log("\n📌 Success responses also provide guidance:");
  console.log(`   - tell_user: "${demo5Result.tell_user}"`);

  // ========================================================================
  // Summary
  // ========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY: The Failing Forward Pattern");
  console.log("=".repeat(70));
  console.log(`
The key insight: Tool responses ARE instructions.

When an error occurs, the response includes:
  • status: What happened ("failed", "needs_action")
  • error: Machine-readable error code
  • message: Human-readable explanation
  • next_action: What tool to call next
  • next_action_params: Pre-filled parameters for that tool
  • hint: Strategy guidance for the agent
  • tell_user: What to communicate to the user

An agent with just a MINIMAL system prompt ("You are an expense assistant")
can successfully navigate complex workflows because the tool responses
teach it what to do at each step.

To see this in action with a real agent, run:
  npx tsx src/expense-agent.ts "Submit a 75 dollar lunch expense"
`);

  await client.close();
}

runDemo().catch((error) => {
  console.error("Demo error:", error.message);
  process.exit(1);
});
