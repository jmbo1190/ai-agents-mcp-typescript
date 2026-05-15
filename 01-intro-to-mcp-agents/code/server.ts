/**
 * MCP Tool Server - Tutorial 01
 *
 * This server exposes two tools:
 * - list_files: List contents of a directory
 * - read_file: Read contents of a file
 *
 * Run with: npx tsx server.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const server = new McpServer({
  name: "file-server",
  version: "1.0.0",
});

// Tool 1: List directory contents
server.registerTool(
  "list_files",
  {
    description: "List files and directories in a given path",
    inputSchema: z.object({
      path: z
        .string()
        .describe("Directory path to list (use '.' for current directory)"),
    }),
  },
  async ({ path: dirPath }) => {
    try {
      const absolutePath = path.resolve(dirPath);
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });

      const lines = entries.map((entry) => {
        const icon = entry.isDirectory() ? "📁" : "📄";
        return `${icon} ${entry.name}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: lines.length > 0 ? lines.join("\n") : "(empty directory)",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool 2: Read file contents
server.registerTool(
  "read_file",
  {
    description: "Read the contents of a text file",
    inputSchema: z.object({
      path: z.string().describe("Path to the file to read"),
    }),
  },
  async ({ path: filePath }) => {
    try {
      const absolutePath = path.resolve(filePath);
      const content = await fs.readFile(absolutePath, "utf-8");

      return {
        content: [
          {
            type: "text" as const,
            text: content,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Could not read file "${filePath}". ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("File server running on stdio");
}

main().catch(console.error);
