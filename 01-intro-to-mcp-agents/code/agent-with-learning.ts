/**
 * File Research Agent with Active Learning - Tutorial 03
 *
 * This agent demonstrates the Active Learning pattern:
 * it reads available resources BEFORE using tools, building
 * contextual knowledge that helps it act more effectively.
 *
 * Run with: npm run agent-learn -- "Your question here"
 *
 * Example:
 *   npm run agent-learn -- "What is this project about?"
 *   npm run agent-learn -- "How should I explore this codebase?"
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createLLMFromEnv, Message, Tool } from "./llm.js";

// Convert MCP tools to our LLM format
function mcpToolsToLLMTools(mcpTools: any[]): Tool[] {
  return mcpTools.map(t => ({
    name: t.name,
    description: t.description || `Tool: ${t.name}`,
    inputSchema: t.inputSchema,
  }));
}

// Extract text from MCP result
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getResultText(result: any): string {
  if (!result.content || result.content.length === 0) return "(no output)";
  return result.content
    .map((c: { type: string; text?: string }) =>
      c.type === "text" ? c.text : JSON.stringify(c)
    )
    .join("\n");
}

async function runAgentWithLearning(userMessage: string) {
  // Create LLM (auto-detects from environment variables)
  const llm = createLLMFromEnv();

  // ========================================
  // PERCEIVE: Connect, discover tools AND resources
  // ========================================
  console.log("Connecting to MCP server...\n");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "server-with-resources.ts"],
  });

  const client = new Client(
    { name: "learning-agent", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  // Discover tools
  const { tools: mcpTools } = await client.listTools();
  const tools = mcpToolsToLLMTools(mcpTools);
  console.log(`Discovered ${tools.length} tools: ${tools.map(t => t.name).join(", ")}`);

  // Discover resources
  const { resources } = await client.listResources();
  console.log(`Discovered ${resources.length} resources: ${resources.map(r => r.name).join(", ")}\n`);

  // ========================================
  // ACTIVE LEARNING: Read resources before acting
  // ========================================
  console.log("=== ACTIVE LEARNING PHASE ===");
  console.log("Reading available resources to build context...\n");

  let contextKnowledge = "";

  for (const resource of resources) {
    console.log(`Reading: ${resource.name} (${resource.uri})`);
    try {
      const content = await client.readResource({ uri: resource.uri });
      if (content.contents[0]) {
        const text = "text" in content.contents[0]
          ? content.contents[0].text
          : JSON.stringify(content.contents[0]);
        contextKnowledge += `\n\n## ${resource.name}\n${text}`;
        console.log(`  ✓ Loaded ${text.length} characters`);
      }
    } catch (error) {
      console.log(`  ✗ Failed to read: ${error}`);
    }
  }

  console.log("\n=== LEARNING COMPLETE ===\n");

  // ========================================
  // INITIALIZE CONVERSATION WITH LEARNED CONTEXT
  // ========================================
  const messages: Message[] = [
    {
      role: "system",
      content: `You are a research assistant that can explore and analyze files in a folder.

IMPORTANT: You have studied the following documentation before starting. Use this knowledge to guide your exploration and provide better answers:

${contextKnowledge}

Your job is to help users understand what's in a codebase or document collection.
Follow the recommended workflows and best practices from the documentation above.

When exploring:
1. Follow the "Recommended Workflow" from the guide
2. Use the file patterns knowledge to prioritize what to read
3. Read documentation files before diving into code
4. Synthesize information from multiple files to answer questions

Be thorough but concise.`,
    },
    { role: "user", content: userMessage },
  ];

  // ========================================
  // THE AGENT LOOP (same as before)
  // ========================================
  let iteration = 0;
  const maxIterations = 10;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n--- Iteration ${iteration} ---`);

    // DECIDE: Ask LLM what to do
    const response = await llm.chat(messages, tools);

    if (response.toolCalls.length > 0) {
      // ACT: Execute each tool call
      for (const toolCall of response.toolCalls) {
        console.log(`Calling: ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`);

        const result = await client.callTool({
          name: toolCall.name,
          arguments: toolCall.arguments,
        });

        // OBSERVE: Process result and add to conversation
        const resultText = getResultText(result);
        const isError = result.isError === true;

        // Show a preview of the result
        const preview = resultText.substring(0, 200);
        console.log(`Result${isError ? " (error)" : ""}: ${preview}${resultText.length > 200 ? "..." : ""}`);

        // Add the interaction to conversation history
        messages.push({
          role: "assistant",
          content: `I'll use the ${toolCall.name} tool.`,
        });
        messages.push({
          role: "user",
          content: `Tool result:\n${resultText}`,
        });
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

// ========================================
// Main entry point
// ========================================
const userMessage = process.argv[2] || "What is this project and how is it structured?";

console.log("=".repeat(50));
console.log("FILE RESEARCH AGENT (with Active Learning)");
console.log("=".repeat(50));
console.log(`\nQuestion: ${userMessage}\n`);

runAgentWithLearning(userMessage).catch(error => {
  console.error("Agent error:", error.message);
  process.exit(1);
});
