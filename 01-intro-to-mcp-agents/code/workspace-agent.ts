/**
 * Context-Aware Workspace Agent - Tutorial 05
 *
 * This agent demonstrates the Active Learning pattern with context discovery.
 * It checks for directory context rules before creating or modifying files.
 *
 * Run with: npm run workspace-agent -- "Your request here"
 *
 * Examples:
 *   npm run workspace-agent -- "Create an expense for my $200 dinner at Fancy Restaurant"
 *   npm run workspace-agent -- "What are the rules for travel expenses?"
 *   npm run workspace-agent -- "Create a weekly report for Project Alpha"
 */

import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createLLMFromEnv, Message, Tool } from "./llm.js";

// Convert MCP tools to our LLM format
function mcpToolsToLLMTools(
  mcpTools: { name: string; description?: string; inputSchema: unknown }[],
): Tool[] {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description || `Tool: ${t.name}`,
    // MCP SDK returns inputSchema as unknown, but we know it matches JSON Schema
    inputSchema: t.inputSchema as Tool["inputSchema"],
  }));
}

// Extract text from MCP result
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getResultText(result: any): string {
  if (!result.content || result.content.length === 0) return "(no output)";
  return result.content
    .map((c: { type: string; text?: string }) =>
      c.type === "text" ? c.text : JSON.stringify(c),
    )
    .join("\n");
}

// The system prompt that instills context discovery habits
const systemPrompt = `You are a workspace assistant that helps manage files and content.

## CRITICAL: Context Discovery Protocol

Before creating or modifying ANY file, you MUST:
1. Call get_directory_context(path) for the target directory
2. Read and understand ALL context rules (global AND local)
3. Follow the naming conventions and required fields exactly
4. Use the templates provided in the context

This is not optional. The context files contain rules that MUST be followed.

## When Asked to Create Files

1. First, determine where the file should go based on what it is:
   - Expenses go in "expenses/" or "expenses/travel/" for travel-related
   - Reports go in "reports/"
   - Project files go in "projects/"
2. Call get_directory_context for that location
3. Follow the naming convention from the context EXACTLY
4. Include all required fields from the context
5. Use the template if one is provided

## When Asked About Rules

If the user asks about rules or conventions:
1. Call get_directory_context for the relevant directory
2. Summarize the rules clearly
3. Point out any inheritance from parent directories

## Available Tools

- list_files: See what's in a directory
- read_file: Read file contents
- write_file: Create or update files
- get_directory_context: Get rules for a directory (USE THIS FIRST!)

## File Path Convention

All paths are relative to the workspace root. Use paths like:
- "." for workspace root
- "expenses" for the expenses directory
- "expenses/travel" for travel expenses
- "reports" for reports

## Important Reminders

- Context discovery is NOT optional - always check before creating files
- Naming conventions are strict - follow them exactly
- Ask the user for any missing required information before creating files
- Show the user what you're creating before you create it`;

async function runWorkspaceAgent(userMessage: string) {
  // Create LLM (auto-detects from environment variables)
  const llm = await createLLMFromEnv();

  // Connect to the workspace server
  console.log("Connecting to workspace server...\n");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "workspace-server.ts"],
  });

  const client = new Client(
    { name: "workspace-agent", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  // Discover tools
  const { tools: mcpTools } = await client.listTools();
  const tools = mcpToolsToLLMTools(mcpTools);
  console.log(
    `Discovered ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}\n`,
  );

  // Initialize conversation
  const messages: Message[] = [
    {
      role: "system",
      content: systemPrompt
    },
    {
      role: "user",
      content: userMessage,
    },
  ];

  // The Agent Loop
  let iteration = 0;
  const maxIterations = 15;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n--- Iteration ${iteration} ---`);

    // DECIDE: Ask LLM what to do
    const response = await llm.chat(messages, tools);

    if (response.toolCalls.length > 0) {
      // ACT: Execute each tool call
      for (const toolCall of response.toolCalls) {
        console.log(
          `Calling: ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`,
        );

        const result = await client.callTool({
          name: toolCall.name,
          arguments: toolCall.arguments,
        });

        // OBSERVE: Process result and add to conversation
        const resultText = getResultText(result);
        const isError = result.isError === true;

        // Show a preview of the result
        // const preview = resultText.substring(0, 300);
        // console.log(
        //   `Result${isError ? " (error)" : ""}: ${preview}${resultText.length > 300 ? "..." : ""}`,
        // );
        if (isError) {
          console.log(`Result (error): ${resultText}`);
        }

        // Add the interaction to conversation history
        messages.push(
          {
            role: "assistant",
            content: `I'll use the ${toolCall.name} tool.`,
          },
          {
            role: "user",
            content: `Tool result:\n${resultText}`,
          },
        );
      }
    } else {
      // FINISH: No tool call means the LLM is done
      console.log("\n" + "=".repeat(50));
      console.log("FINAL RESPONSE");
      console.log("=".repeat(50) + "\n");
      console.log(response.content);
      break;
    }
  }

  if (iteration >= maxIterations) {
    console.log("\n(Reached maximum iterations)");
  }

  await client.close();
}

// Main entry point
// ========================================
let userMessage; // || "What files are in the current directory?";
const defaultQuestion = process.argv[2] || "What directories are available and what are their rules?";

if (!userMessage) {
  // prompt the user to enter a Question and await input
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string) =>
    new Promise<string>((resolve) => rl.question(query, resolve));

  userMessage = await question(
    `Enter your question to the file research agent [${defaultQuestion}]: `,
  );
  userMessage = userMessage.trim() || defaultQuestion;
  rl.close();
}

console.log("=".repeat(50));
console.log("CONTEXT-AWARE WORKSPACE AGENT");
console.log("=".repeat(50));
console.log(`\nQuestion: ${userMessage}\n`);

runWorkspaceAgent(userMessage).catch((error) => {
  console.error("Agent error:", error.message);
  process.exit(1);
});
