/**
 * Expense Agent - Demonstrating Response-as-Instruction
 *
 * This agent has a MINIMAL system prompt. It doesn't know about "Failing Forward"
 * or any special error handling patterns. It's just an expense assistant.
 *
 * The key insight: the agent successfully navigates complex workflows because
 * the TOOL RESPONSES guide it. The tools return structured responses with
 * next_action, next_action_params, and hints that teach the agent what to do.
 *
 * This demonstrates that well-designed tool responses can guide any reasonable
 * LLM without requiring special instructions about the pattern.
 *
 * Run with: npx tsx src/expense-agent.ts "Submit a $150 dinner with client from last week"
 */

import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import { load_api_keys } from './load_api_key.js';
await load_api_keys(); // Load API keys (if needed)

// Verify API key
if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY not found. Set it in .env file or environment.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============================================================================
// Types
// ============================================================================

interface ToolResult {
  status: string;
  error?: string;
  message: string;
  next_action?: string;
  next_action_params?: Record<string, unknown>;
  hint?: string;
  tell_user?: string;
  [key: string]: unknown;
}

// Use OpenAI's built-in type for tools
type ResponsesTool = OpenAI.Responses.Tool;

// Responses API input message types
type ResponsesInputItem =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "system"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

// Responses API output item types
interface FunctionCallOutput {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

interface MessageOutput {
  type: "message";
  id: string;
  role: "assistant";
  content: Array<{ type: "output_text"; text: string }>;
}

type ResponseOutputItem = FunctionCallOutput | MessageOutput | { type: string; [key: string]: unknown };

// ============================================================================
// Helper Functions
// ============================================================================

function mcpToolsToResponsesAPI(mcpTools: any[]): ResponsesTool[] {
  return mcpTools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description || `Tool: ${t.name}`,
    parameters: t.inputSchema || { type: "object", properties: {} },
    strict: false,
  }));
}

function getResultText(result: any): string {
  if (!result.content?.length) return "(no output)";
  return result.content.map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
}

function parseToolResult(resultText: string): ToolResult | null {
  try {
    return JSON.parse(resultText);
  } catch {
    return null;
  }
}

function getOutputText(response: any): string | null {
  // The Responses API provides output_text as a convenience property
  if (response.output_text) {
    return response.output_text;
  }

  // Fallback: look through output items for message content
  if (response.output) {
    for (const item of response.output) {
      if (item.type === "message" && item.content) {
        for (const content of item.content) {
          if (content.type === "output_text" && content.text) {
            return content.text;
          }
        }
      }
    }
  }

  return null;
}

function hasFunctionCalls(response: any): boolean {
  if (!response.output) return false;
  return response.output.some((item: any) => item.type === "function_call");
}

function getFunctionCalls(response: any): FunctionCallOutput[] {
  if (!response.output) return [];
  return response.output.filter((item: any) => item.type === "function_call") as FunctionCallOutput[];
}

// ============================================================================
// Main Agent Loop
// ============================================================================

async function runAgent(userMessage: string) {
  console.log("\n" + "=".repeat(60));
  console.log("FAILING FORWARD EXPENSE AGENT");
  console.log("=".repeat(60));
  console.log(`\nUser request: ${userMessage}\n`);

  // Connect to the expense server
  console.log("Connecting to Expense Server...\n");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/expense-server.ts"],
  });

  const client = new Client({ name: "expense-agent", version: "1.0.0" }, { capabilities: {} });

  await client.connect(transport);

  const { tools: mcpTools } = await client.listTools();
  const tools = mcpToolsToResponsesAPI(mcpTools);
  console.log(`Discovered ${tools.length} tools: ${mcpTools.map((t: any) => t.name).join(", ")}\n`);

  // MINIMAL system prompt - the agent knows NOTHING about "Failing Forward"
  // or any special error handling patterns. It's just an expense assistant.
  // The tool responses will guide it through any issues.
  const systemInstructions = `You are an expense submission assistant that helps users submit business expenses.

Today's date is ${new Date().toISOString().split("T")[0]}.

Be helpful and guide the user through the expense submission process.`;

  // Build input for Responses API
  // The input array holds the conversation context
  let input: ResponsesInputItem[] = [
    {
      role: "user",
      content: userMessage,
    },
  ];

  // Agent loop
  let iteration = 0;
  const maxIterations = 10;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n--- Iteration ${iteration} ---`);

    // Call the Responses API
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      instructions: systemInstructions,
      input: input,
      tools: tools,
    });

    // Check if the model wants to call functions
    if (hasFunctionCalls(response)) {
      const functionCalls = getFunctionCalls(response);

      for (const functionCall of functionCalls) {
        const args = JSON.parse(functionCall.arguments);
        console.log(`\nCalling: ${functionCall.name}`);
        console.log(`Arguments: ${JSON.stringify(args, null, 2)}`);

        const result = await client.callTool({
          name: functionCall.name,
          arguments: args,
        });

        const resultText = getResultText(result);
        const parsed = parseToolResult(resultText);

        // Show the result
        console.log(`\nResult:`);
        if (parsed) {
          console.log(`  Status: ${parsed.status}`);
          if (parsed.error) console.log(`  Error: ${parsed.error}`);
          console.log(`  Message: ${parsed.message}`);
          if (parsed.next_action) {
            console.log(`  Next Action: ${parsed.next_action}`);
            if (parsed.next_action_params) {
              console.log(`  Next Action Params: ${JSON.stringify(parsed.next_action_params, null, 4)}`);
            }
          }
          if (parsed.hint) console.log(`  Hint: ${parsed.hint}`);
        } else {
          console.log(`  ${resultText.substring(0, 200)}...`);
        }

        // Add the function call and its output to the input for the next iteration
        // First, add the function call that was made
        input.push({
          type: "function_call",
          call_id: functionCall.call_id,
          name: functionCall.name,
          arguments: functionCall.arguments,
        });

        // Then add the function call output
        input.push({
          type: "function_call_output",
          call_id: functionCall.call_id,
          output: resultText,
        });
      }
    } else {
      // Agent finished - show final response
      const outputText = getOutputText(response);
      console.log("\n" + "=".repeat(60));
      console.log("FINAL RESPONSE");
      console.log("=".repeat(60));
      console.log(`\n${outputText}\n`);
      break;
    }
  }

  if (iteration >= maxIterations) {
    console.log("\n(Reached maximum iterations)");
  }

  await client.close();
}

// ============================================================================
// Entry Point
// ============================================================================

const userMessage = process.argv[2] || "Submit a $150 dinner expense with a client from last Tuesday";

runAgent(userMessage).catch((error) => {
  console.error("Agent error:", error.message);
  process.exit(1);
});
