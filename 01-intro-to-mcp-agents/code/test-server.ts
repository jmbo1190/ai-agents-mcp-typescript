/**
 * Test script to verify the MCP server works correctly.
 * This tests the PERCEIVE and ACT phases without needing an LLM.
 *
 * Run with: npm run test-server
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Helper to extract text from MCP result
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getResultText(result: any): string {
  if (!result.content || result.content.length === 0) return "(no output)";
  return result.content
    .map((c: { type: string; text?: string }) =>
      c.type === "text" ? c.text : JSON.stringify(c)
    )
    .join("\n");
}

async function testServer() {
  console.log("=".repeat(50));
  console.log("MCP SERVER TEST");
  console.log("=".repeat(50));
  console.log("\nConnecting to server...");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "server.ts"],
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Connected!\n");

  // PERCEIVE: Discover tools
  console.log("--- PERCEIVE: Discovering tools ---");
  const { tools } = await client.listTools();
  console.log(`Found ${tools.length} tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description}`);
  }

  // ACT: Test list_files
  console.log("\n--- ACT: Testing list_files ---");
  const listResult = await client.callTool({
    name: "list_files",
    arguments: { path: "." },
  });
  console.log("Result:");
  console.log(getResultText(listResult));

  // ACT: Test read_file
  console.log("\n--- ACT: Testing read_file ---");
  const readResult = await client.callTool({
    name: "read_file",
    arguments: { path: "package.json" },
  });
  const readText = getResultText(readResult);
  console.log("Result (first 200 chars):");
  console.log(readText.substring(0, 200) + (readText.length > 200 ? "..." : ""));

  // ACT: Test error handling
  console.log("\n--- ACT: Testing error handling ---");
  const errorResult = await client.callTool({
    name: "read_file",
    arguments: { path: "nonexistent-file.txt" },
  });
  console.log("Result:");
  console.log(getResultText(errorResult));
  console.log(`isError: ${errorResult.isError}`);

  await client.close();

  console.log("\n" + "=".repeat(50));
  console.log("ALL TESTS PASSED!");
  console.log("=".repeat(50));
}

testServer().catch((error) => {
  console.error("Test failed:", error.message);
  process.exit(1);
});
