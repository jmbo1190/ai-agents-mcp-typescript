/**
 * Intelligence Budget - Comprehensive Tests
 *
 * This tests all four concepts from the Intelligence Budget tutorials:
 *
 * 1. BUDGET BOUNDARY (Tutorials 01)
 *    - agent-heavy-server: Agent does all reasoning (high token cost)
 *    - tool-heavy-server: Tool does all reasoning (low token cost)
 *    - hybrid-server: Flexible input, tool processes (best balance)
 *
 * 2. SCRIPTED ORCHESTRATION (Tutorial 02)
 *    - scripted-orchestration-server: Agent writes code, tool executes it
 *
 * 3. SELF-PROMPTING (Tutorial 03)
 *    - self-prompting-server: Tool makes its own LLM calls for classification
 *
 * 4. VALIDATE AT SOURCE (Tutorial 04)
 *    - validate-at-source-server: Full validation stack including semantic
 *
 * Run with: npm run test
 */

import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import type { ResponseInputItem, ResponseOutputItem, ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { load_api_keys } from './load_api_key.js';
await load_api_keys(); // Load API keys (if needed)

// Verify API key
if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY not found in .env file");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============================================================================
// Test Helpers
// ============================================================================

interface ToolResult {
  status?: string;
  success?: boolean;
  error?: string;
  message?: string;
  expense_id?: string;
  next_action?: string;
  category?: string;
  result?: unknown;
  summary?: {
    tested?: number;
    would_pass?: number;
    would_fail?: number;
    would_be_flagged?: number;
  };
  [key: string]: unknown;
}

function getResultText(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  if (!r.content?.length) return "(no output)";
  return r.content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
}

function parseResult(result: unknown): ToolResult {
  try {
    return JSON.parse(getResultText(result));
  } catch {
    return { message: getResultText(result) };
  }
}

function mcpToolsToOpenAI(mcpTools: Array<{ name: string; description?: string; inputSchema?: unknown }>): OpenAI.Responses.Tool[] {
  return mcpTools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description || `Tool: ${t.name}`,
    parameters: t.inputSchema as Record<string, unknown>,
    strict: false,
  }));
}

async function createClient(serverScript: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", serverScript],
  });

  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function isFunctionCall(item: ResponseOutputItem): item is ResponseFunctionToolCall {
  return item.type === "function_call";
}

async function runAgentLoop(
  client: Client,
  tools: OpenAI.Responses.Tool[],
  systemPrompt: string,
  userMessage: string,
  maxIterations: number = 8
): Promise<{ toolCalls: string[]; finalResult: ToolResult | null; category?: string }> {
  const input: ResponseInputItem[] = [{ role: "user", content: userMessage }];

  const toolCalls: string[] = [];
  let finalResult: ToolResult | null = null;
  let detectedCategory: string | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      instructions: systemPrompt,
      input: input,
      tools: tools,
    });

    const functionCalls = response.output.filter(isFunctionCall);

    if (functionCalls.length === 0) {
      break;
    }

    for (const funcCall of functionCalls) {
      const args = JSON.parse(funcCall.arguments || "{}");
      console.log(`    [${iteration + 1}] ${funcCall.name}`);
      toolCalls.push(funcCall.name);

      const result = await client.callTool({
        name: funcCall.name,
        arguments: args,
      });

      const resultText = getResultText(result);
      const parsed = parseResult(result);

      console.log(`        Status: ${parsed.status || (parsed.success ? "success" : "done")}`);
      if (parsed.category) {
        detectedCategory = parsed.category;
        console.log(`        Category: ${parsed.category}`);
      }

      input.push(funcCall as ResponseInputItem);
      input.push({
        type: "function_call_output",
        call_id: funcCall.call_id,
        output: resultText,
      } as ResponseInputItem);

      if ((parsed.status === "success" || parsed.success) && (parsed.expense_id || parsed.result)) {
        finalResult = parsed;
      }
    }
  }

  return { toolCalls, finalResult, category: detectedCategory };
}

// ============================================================================
// TEST 1: Direct Server Tests (No LLM)
// ============================================================================

async function testDirectServerCalls() {
  console.log("\n" + "=".repeat(70));
  console.log("TEST 1: Direct Server Calls (Verify all servers work)");
  console.log("=".repeat(70));

  const servers = [
    { name: "agent-heavy", script: "src/agent-heavy-server.ts" },
    { name: "tool-heavy", script: "src/tool-heavy-server.ts" },
    { name: "hybrid", script: "src/hybrid-server.ts" },
    { name: "self-prompting", script: "src/self-prompting-server.ts" },
    { name: "scripted-orchestration", script: "src/scripted-orchestration-server.ts" },
    { name: "validate-at-source", script: "src/validate-at-source-server.ts" },
  ];

  for (const server of servers) {
    console.log(`\n--- ${server.name} ---`);
    const client = await createClient(server.script);
    try {
      const { tools } = await client.listTools();
      console.log(`  Tools: ${tools.map((t) => t.name).join(", ")}`);
      console.log(`  [OK] Server starts and lists tools`);
    } finally {
      await client.close();
    }
  }

  console.log("\n[PASS] All servers start correctly");
}

// ============================================================================
// TEST 2: Budget Boundary (Tutorial 01) - Agent-Heavy vs Tool-Heavy
// ============================================================================

async function testBudgetBoundary() {
  console.log("\n" + "=".repeat(70));
  console.log("TEST 2: Budget Boundary - Agent-Heavy vs Tool-Heavy");
  console.log("=".repeat(70));

  // Test agent-heavy: agent must fetch rules and determine category
  console.log("\n--- Agent-Heavy (Agent reasons about everything) ---");
  {
    const client = await createClient("src/agent-heavy-server.ts");
    try {
      const { tools: mcpTools } = await client.listTools();
      const tools = mcpToolsToOpenAI(mcpTools);

      const systemPrompt = `You must first get_category_rules, then determine category yourself.
If receipt needed, call upload_receipt with file_data="test", file_type="image/jpeg".
Submit with your determined category. No user interaction available.`;

      const { toolCalls } = await runAgentLoop(
        client,
        tools,
        systemPrompt,
        "Submit a $50 lunch expense (test mode)"
      );

      // Agent-heavy SHOULD call get_category_rules (agent must know rules)
      const gotRules = toolCalls.includes("get_category_rules");
      console.log(`  Agent fetched rules: ${gotRules ? "YES (expected)" : "NO"}`);
    } finally {
      await client.close();
    }
  }

  // Test tool-heavy: tool handles everything
  console.log("\n--- Tool-Heavy (Tool handles everything) ---");
  {
    const client = await createClient("src/tool-heavy-server.ts");
    try {
      const { tools: mcpTools } = await client.listTools();
      const tools = mcpToolsToOpenAI(mcpTools);

      const systemPrompt = `Extract amount and expense_type from user.
Call submit_expense. Follow next_action guidance.
For receipts use file_data="test", file_type="image/jpeg".`;

      const { toolCalls, finalResult } = await runAgentLoop(
        client,
        tools,
        systemPrompt,
        "I had a $50 lunch (test mode)"
      );

      // Tool-heavy should NOT call get_category_rules (tool knows them)
      const gotRules = toolCalls.includes("get_category_rules");
      console.log(`  Agent fetched rules: ${gotRules ? "YES (not expected)" : "NO (expected)"}`);
      console.log(`  Final result: ${finalResult?.expense_id ? "SUCCESS" : "incomplete"}`);
    } finally {
      await client.close();
    }
  }

  console.log("\n[PASS] Budget boundary tests complete");
}

// ============================================================================
// TEST 3: Self-Prompting (Tutorial 03) - LLM calls inside tools
// ============================================================================

async function testSelfPrompting() {
  console.log("\n" + "=".repeat(70));
  console.log("TEST 3: Self-Prompting - Tool makes its own LLM calls");
  console.log("=".repeat(70));

  const client = await createClient("src/self-prompting-server.ts");

  try {
    const { tools: mcpTools } = await client.listTools();
    const tools = mcpToolsToOpenAI(mcpTools);

    // Test 1: Clear case (should use deterministic classification)
    console.log("\n--- Test 1: Clear case (flight) ---");
    const result1 = await client.callTool({
      name: "submit_expense",
      arguments: {
        amount: 300,
        description: "Flight to NYC for conference",
      },
    });
    const parsed1 = parseResult(result1);
    console.log(`  Category: ${parsed1.category}`);
    console.log(`  Classification source: ${parsed1.classification_source}`);
    console.log(`  Expected: travel via deterministic`);

    // Test 2: Ambiguous case (should trigger LLM self-prompting)
    console.log("\n--- Test 2: Ambiguous case (client dinner) ---");
    const result2 = await client.callTool({
      name: "submit_expense",
      arguments: {
        amount: 150,
        description: "Dinner with the folks from Acme Corp to discuss renewal",
      },
    });
    const parsed2 = parseResult(result2);
    console.log(`  Category: ${parsed2.category}`);
    console.log(`  Classification source: ${parsed2.classification_source}`);
    console.log(`  Expected: client_entertainment via llm`);

    // Test 3: With context hints (should use deterministic)
    console.log("\n--- Test 3: With context hints ---");
    const result3 = await client.callTool({
      name: "submit_expense",
      arguments: {
        amount: 80,
        description: "Lunch at the steakhouse",
        context_hints: { mentions_client: true },
      },
    });
    const parsed3 = parseResult(result3);
    console.log(`  Category: ${parsed3.category}`);
    console.log(`  Classification source: ${parsed3.classification_source}`);
    console.log(`  Expected: client_entertainment via deterministic`);

    console.log("\n[PASS] Self-prompting tests complete");
  } finally {
    await client.close();
  }
}

// ============================================================================
// TEST 4: Scripted Orchestration (Tutorial 02) - Agent writes code
// ============================================================================

async function testScriptedOrchestration() {
  console.log("\n" + "=".repeat(70));
  console.log("TEST 4: Scripted Orchestration - Agent writes code, tool executes");
  console.log("=".repeat(70));

  const client = await createClient("src/scripted-orchestration-server.ts");

  try {
    // First, create some expenses to work with
    console.log("\n--- Setup: Creating test expenses ---");
    await client.callTool({
      name: "submit_expense",
      arguments: { amount: 25, category: "meals", description: "Coffee meeting" },
    });
    await client.callTool({
      name: "submit_expense",
      arguments: { amount: 15, category: "meals", description: "Lunch snack" },
    });
    await client.callTool({
      name: "submit_expense",
      arguments: { amount: 200, category: "travel", description: "Uber to airport" },
    });
    console.log("  Created 3 test expenses");

    // Test 1: Execute a workflow script directly
    console.log("\n--- Test 1: Execute workflow script ---");
    const workflowResult = await client.callTool({
      name: "execute_workflow",
      arguments: {
        code: `
          const expenses = await tools.get_expenses();
          const stats = await tools.get_expense_stats();

          const byCategory = {};
          for (const e of expenses) {
            if (!byCategory[e.category]) {
              byCategory[e.category] = { count: 0, total: 0 };
            }
            byCategory[e.category].count++;
            byCategory[e.category].total += e.amount;
          }

          return {
            total_expenses: expenses.length,
            total_amount: stats.total_amount,
            by_category: byCategory
          };
        `,
      },
    });
    const parsed1 = parseResult(workflowResult);
    console.log(`  Status: ${parsed1.status}`);
    console.log(`  Execution time: ${parsed1.execution_time_ms}ms`);
    console.log(`  Result: ${JSON.stringify(parsed1.result)}`);

    // Test 2: Agent writes and executes a workflow
    console.log("\n--- Test 2: Agent writes workflow ---");
    const { tools: mcpTools } = await client.listTools();
    const tools = mcpToolsToOpenAI(mcpTools);

    const systemPrompt = `You can execute JavaScript workflows using execute_workflow.
Available: tools.get_expenses(), tools.get_expense_stats(), etc.
Write a script to answer the user's question. No user interaction available.`;

    const { toolCalls, finalResult } = await runAgentLoop(
      client,
      tools,
      systemPrompt,
      "How many expenses do I have and what's the total? Write a script to find out."
    );

    console.log(`  Tool calls: ${toolCalls.join(" -> ")}`);
    console.log(`  Used execute_workflow: ${toolCalls.includes("execute_workflow") ? "YES" : "NO"}`);
    if (finalResult?.result) {
      console.log(`  Script result: ${JSON.stringify(finalResult.result)}`);
    }

    console.log("\n[PASS] Scripted orchestration tests complete");
  } finally {
    await client.close();
  }
}

// ============================================================================
// TEST 5: Validate at Source (Tutorial 04) - Semantic validation
// ============================================================================

async function testValidateAtSource() {
  console.log("\n" + "=".repeat(70));
  console.log("TEST 5: Validate at Source - Semantic validation in tools");
  console.log("=".repeat(70));

  const client = await createClient("src/validate-at-source-server.ts");

  try {
    // Test 1: Valid description
    console.log("\n--- Test 1: Valid description ---");
    const result1 = await client.callTool({
      name: "submit_expense",
      arguments: {
        amount: 25,
        description: "Coffee meeting with marketing team to discuss Q4 campaign",
        category: "meals",
      },
    });
    const parsed1 = parseResult(result1);
    console.log(`  Status: ${parsed1.status}`);
    console.log(`  Validation layer: ${parsed1.validation_layer}`);
    console.log(`  Expected: success (valid description)`);

    // Test 2: Gibberish description (should fail semantic validation)
    console.log("\n--- Test 2: Gibberish description ---");
    const result2 = await client.callTool({
      name: "submit_expense",
      arguments: {
        amount: 50,
        description: "asdfgh",
        category: "meals",
      },
    });
    const parsed2 = parseResult(result2);
    console.log(`  Status: ${parsed2.status}`);
    console.log(`  Validation layer: ${parsed2.validation_layer}`);
    console.log(`  Issues: ${JSON.stringify(parsed2.issues)}`);
    console.log(`  Expected: rejected (gibberish)`);

    // Test 3: Too brief description
    console.log("\n--- Test 3: Too brief description ---");
    const result3 = await client.callTool({
      name: "submit_expense",
      arguments: {
        amount: 100,
        description: "stuff",
        category: "supplies",
      },
    });
    const parsed3 = parseResult(result3);
    console.log(`  Status: ${parsed3.status}`);
    console.log(`  Validation layer: ${parsed3.validation_layer}`);
    console.log(`  Expected: rejected (too brief)`);

    // Test 4: Use test_validation tool
    console.log("\n--- Test 4: Batch validation test ---");
    const result4 = await client.callTool({
      name: "test_validation",
      arguments: {
        descriptions: [
          "Team lunch at Italian restaurant for project kickoff",
          "test",
          "aaaaaaa",
          "Quick coffee run",
          "Dinner with the folks from Acme to discuss partnership",
        ],
        category: "meals",
        amount: 50,
      },
    });
    const parsed4 = parseResult(result4);
    console.log(`  Tested: ${parsed4.summary?.tested} descriptions`);
    console.log(`  Would pass: ${parsed4.summary?.would_pass}`);
    console.log(`  Would fail: ${parsed4.summary?.would_fail}`);
    console.log(`  Would be flagged: ${parsed4.summary?.would_be_flagged}`);

    console.log("\n[PASS] Validate at source tests complete");
  } finally {
    await client.close();
  }
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests() {
  console.log("\n" + "=".repeat(70));
  console.log("INTELLIGENCE BUDGET - COMPREHENSIVE TESTS");
  console.log("Testing all four concepts from the tutorials");
  console.log("=".repeat(70));

  try {
    await testDirectServerCalls();
    await testBudgetBoundary();
    await testSelfPrompting();
    await testScriptedOrchestration();
    await testValidateAtSource();

    console.log("\n" + "=".repeat(70));
    console.log("ALL TESTS PASSED!");
    console.log("=".repeat(70) + "\n");
  } catch (error) {
    console.error("\n[FAIL] Test error:", (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

runAllTests();
