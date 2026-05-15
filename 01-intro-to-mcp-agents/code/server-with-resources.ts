/**
 * MCP Tool Server with Resources - Tutorial 03
 *
 * This server extends the basic file server with Resources,
 * demonstrating the Active Learning pattern. Resources provide
 * documentation that agents can read before using tools.
 *
 * Run with: npm run server-resources
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const server = new McpServer({
  name: "file-server-with-resources",
  version: "1.0.0",
});

// ============================================
// TOOLS (same as before)
// ============================================

server.tool(
  "list_files",
  `List files and directories in a given path.

TIP: Read resource://files/guide for best practices on exploring directories.`,
  {
    path: z.string().describe("Directory path to list (use '.' for current directory)"),
  },
  async ({ path: dirPath }) => {
    try {
      const absolutePath = path.resolve(dirPath);
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });

      const lines = entries.map(entry => {
        const icon = entry.isDirectory() ? "📁" : "📄";
        return `${icon} ${entry.name}`;
      });

      return {
        content: [{
          type: "text" as const,
          text: lines.length > 0 ? lines.join("\n") : "(empty directory)",
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        }],
        isError: true,
      };
    }
  }
);

server.tool(
  "read_file",
  `Read the contents of a text file.

TIP: Read resource://files/guide for tips on which files to examine first.`,
  {
    path: z.string().describe("Path to the file to read"),
  },
  async ({ path: filePath }) => {
    try {
      const absolutePath = path.resolve(filePath);
      const content = await fs.readFile(absolutePath, "utf-8");

      // Truncate very long files
      const maxLength = 10000;
      const truncated = content.length > maxLength
        ? content.substring(0, maxLength) + "\n\n... (truncated)"
        : content;

      return {
        content: [{
          type: "text" as const,
          text: truncated,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: Could not read file "${filePath}". ${error instanceof Error ? error.message : "Unknown error"}`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================
// RESOURCES (new in Tutorial 03)
// ============================================

// Resource 1: Usage guide for the file tools
server.resource(
  "guide",
  "resource://files/guide",
  {
    description: "How to effectively use the file exploration tools",
    mimeType: "text/markdown",
  },
  async () => ({
    contents: [{
      uri: "resource://files/guide",
      mimeType: "text/markdown",
      text: `# File Exploration Guide

## Available Tools

### list_files
Lists contents of a directory. Use this to explore what's available.
- Use "." for current directory
- Returns icons: 📁 for directories, 📄 for files
- Supports relative and absolute paths

### read_file
Reads a text file. Use this to examine file contents.
- Works with any text file (.ts, .js, .json, .md, .txt, etc.)
- Large files are truncated to 10,000 characters
- Returns helpful error messages if file doesn't exist

## Recommended Workflow

When exploring a new codebase or directory:

1. **Start with an overview**: Use list_files(".") to see what's in the current directory
2. **Look for documentation**: Check for README.md, CONTRIBUTING.md, or docs/ folder
3. **Read documentation first**: These files explain the project structure and purpose
4. **Check configuration**: Look at package.json, tsconfig.json for project settings
5. **Explore source code**: Based on what you learned, dive into relevant files

## Common Patterns

### Understanding a Node.js project
1. Read package.json for dependencies and scripts
2. Read README.md for project overview
3. Check tsconfig.json or jsconfig.json for configuration
4. Look for src/ or lib/ for main source code

### Finding specific functionality
1. List directory structure to understand organization
2. Look for descriptive file/folder names
3. Read index.ts or main.ts as entry points
4. Follow imports to find related code

## Error Handling

If you encounter an error:
- "ENOENT" means the file or directory doesn't exist - check the path
- "EACCES" means permission denied - the file may be protected
- "EISDIR" means you tried to read a directory as a file - use list_files instead

## Tips for Effective Exploration

- Start broad, then narrow down based on what you find
- Documentation files often explain more than code comments
- Package.json "main" or "exports" fields point to entry points
- Test files often demonstrate how code is meant to be used
`,
    }],
  })
);

// Resource 2: Common file patterns and what they mean
server.resource(
  "patterns",
  "resource://files/patterns",
  {
    description: "Common file patterns in projects and what they indicate",
    mimeType: "application/json",
  },
  async () => ({
    contents: [{
      uri: "resource://files/patterns",
      mimeType: "application/json",
      text: JSON.stringify({
        patterns: [
          {
            pattern: "package.json",
            meaning: "Node.js project configuration",
            read_priority: "high",
            contains: "dependencies, scripts, project metadata"
          },
          {
            pattern: "tsconfig.json",
            meaning: "TypeScript configuration",
            read_priority: "medium",
            contains: "compiler options, include/exclude paths"
          },
          {
            pattern: "README.md",
            meaning: "Project documentation",
            read_priority: "high",
            contains: "project overview, setup instructions, usage"
          },
          {
            pattern: "*.test.ts or *.spec.ts",
            meaning: "Test files",
            read_priority: "low",
            contains: "tests showing how code should behave"
          },
          {
            pattern: "index.ts",
            meaning: "Module entry point",
            read_priority: "high",
            contains: "main exports, often re-exports from other files"
          },
          {
            pattern: ".env or .env.example",
            meaning: "Environment configuration",
            read_priority: "medium",
            contains: "environment variables (don't expose .env contents)"
          },
          {
            pattern: "src/ or lib/",
            meaning: "Source code directory",
            read_priority: "high",
            contains: "main application code"
          },
          {
            pattern: "dist/ or build/",
            meaning: "Compiled output",
            read_priority: "low",
            contains: "generated files, usually ignored"
          }
        ]
      }, null, 2),
    }],
  })
);

// ============================================
// START SERVER
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("File server with resources running on stdio");
}

main().catch(console.error);
