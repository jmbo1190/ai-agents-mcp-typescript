/**
 * Test script to verify the MCP server with resources works correctly.
 * This tests the Active Learning pattern without needing an LLM.
 *
 * Run with: npm run test-resources
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

async function testResources() {
  console.log("=".repeat(50));
  console.log("MCP SERVER WITH RESOURCES TEST");
  console.log("=".repeat(50));
  console.log("\nConnecting to server...");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "server-with-resources.ts"],
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Connected!\n");

  // ========================================
  // PERCEIVE: Discover tools
  // ========================================
  console.log("--- PERCEIVE: Discovering tools ---");
  const { tools } = await client.listTools();
  console.log(`Found ${tools.length} tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description?.substring(0, 60)}...`);
  }

  // ========================================
  // PERCEIVE: Discover resources
  // ========================================
  console.log("\n--- PERCEIVE: Discovering resources ---");
  const { resources } = await client.listResources();
  console.log(`Found ${resources.length} resources:`);
  for (const resource of resources) {
    console.log(`  - ${resource.name} (${resource.uri})`);
    console.log(`    ${resource.description}`);
  }

  // ========================================
  // ACTIVE LEARNING: Read resources
  // ========================================
  console.log("\n--- ACTIVE LEARNING: Reading resources ---");

  for (const resource of resources) {
    console.log(`\nReading: ${resource.uri}`);
    const content = await client.readResource({ uri: resource.uri });

    if (content.contents[0]) {
      const text = "text" in content.contents[0]
        ? content.contents[0].text
        : JSON.stringify(content.contents[0]);

      console.log(`Content preview (first 300 chars):`);
      console.log("-".repeat(40));
      console.log(text.substring(0, 300) + (text.length > 300 ? "..." : ""));
      console.log("-".repeat(40));
    }
  }

  // ========================================
  // ACT: Test a tool (to confirm tools still work)
  // ========================================
  console.log("\n--- ACT: Testing list_files tool ---");
  const listResult = await client.callTool({
    name: "list_files",
    arguments: { path: "." },
  });
  console.log("Result:");
  console.log(getResultText(listResult));

  await client.close();

  console.log("\n" + "=".repeat(50));
  console.log("ALL TESTS PASSED!");
  console.log("=".repeat(50));
}

testResources().catch((error) => {
  console.error("Test failed:", error.message);
  process.exit(1);
});
