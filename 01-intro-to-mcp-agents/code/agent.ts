/**
 * File Research Agent - Tutorial 02
 *
 * An AI agent that can explore and research files in a folder.
 * Demonstrates the Agent Loop: PERCEIVE -> DECIDE -> ACT -> OBSERVE -> REPEAT
 *
 * Run with: npx tsx agent.ts "Your question here"
 *
 * Example:
 *   npx tsx agent.ts "What files are here and what do they do?"
 *   npx tsx agent.ts "Read package.json and explain the dependencies"
 */

import "dotenv/config"; // Load API keys from .env file (if any)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createLLMFromEnv, Message, Tool } from "./llm.js";

// Convert MCP tools to our LLM format
function mcpToolsToLLMTools(mcpTools: any[]): Tool[] {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description || `Tool: ${t.name}`,
    inputSchema: t.inputSchema,
  }));
}

// Extract text from MCP result
function getResultText(result: any): string {
  if (!result.content?.length) return "(no output)";
  return result.content
    .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
    .join("\n");
}

async function runAgent(userMessage: string) {
  // Create LLM (auto-detects from environment variables)
  const llm = await createLLMFromEnv();

  // ========================================
  // PERCEIVE: Connect to MCP server and discover tools
  // ========================================
  console.log("Connecting to MCP server...\n");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "server.ts"],
  });

  const client = new Client(
    { name: "file-research-agent", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  const { tools: mcpTools } = await client.listTools();
  const tools = mcpToolsToLLMTools(mcpTools);
  console.log(
    `Discovered ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}\n`,
  );

  // Initialize conversation with system prompt
  const messages: Message[] = [
    {
      role: "system",
      content: `You are a research assistant that can explore and analyze files in a folder.

Your job is to help users understand what's in a codebase or document collection.
You can:
- List files to see what's available
- Read files to understand their contents
- Answer questions by synthesizing information from multiple files

When researching a question:
1. First explore to understand what files exist
2. Read relevant files to gather information
3. Synthesize your findings into a clear answer

Be thorough but concise. If you need to read multiple files to answer a question, do so.
When you have enough information to answer the question, provide a clear, well-organized response.`,
    },
    {
      role: "user",
      content: userMessage,
    },
  ];

  // ========================================
  // THE AGENT LOOP
  // ========================================
  let iteration = 0;
  const maxIterations = 10;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n--- Iteration ${iteration} ---`);

    // ========================================
    // DECIDE: Ask LLM what to do
    // ========================================
    const response = await llm.chat(messages, tools);

    if (response.toolCalls.length > 0) {
      // ========================================
      // ACT: Execute each tool call
      // ========================================
      for (const toolCall of response.toolCalls) {
        console.log(
          `Calling: ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`,
        );

        const result = await client.callTool({
          name: toolCall.name,
          arguments: toolCall.arguments,
        });

        // ========================================
        // OBSERVE: Process result and add to conversation
        // ========================================
        const resultText = getResultText(result);
        const isError = result.isError === true;

        // Show a preview of the result
        const preview = resultText.substring(0, 200);
        console.log(
          `Result${isError ? " (error)" : ""}: ${preview}${resultText.length > 200 ? "..." : ""}`,
        );

        // Add the interaction to conversation history
        // This allows the LLM to see what happened and decide what to do next
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

      // REPEAT: Loop continues to next iteration
    } else {
      // ========================================
      // FINISH: No tool call means the LLM is done
      // ========================================
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

// ========================================
// Main entry point
// ========================================
let userMessage = process.argv[2]; // || "What files are in the current directory?";

if (!userMessage) {
  // prompt the user to enter an API key and await input
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string) =>
    new Promise<string>((resolve) => rl.question(query, resolve));
  const defaultQuestion = "What files are in the current directory?";

  userMessage = await question(
    `Enter your question to the file research agent [${defaultQuestion}]: `,
  );
  userMessage = userMessage.trim() || defaultQuestion;
  rl.close();
}

console.log("=".repeat(50));
console.log("FILE RESEARCH AGENT");
console.log("=".repeat(50));
console.log(`\nQuestion: ${userMessage}\n`);

runAgent(userMessage).catch((error) => {
  console.error("Agent error:", error.message);
  process.exit(1);
});
