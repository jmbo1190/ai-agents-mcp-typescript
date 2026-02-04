/**
 * Context-Aware Workspace Server - Tutorial 05
 *
 * This server extends the basic file server with context discovery,
 * demonstrating hierarchical context loading from .context.md files.
 *
 * Run with: npm run workspace-server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";

const server = new McpServer({
  name: "workspace-server",
  version: "1.0.0",
});

// ============================================
// CONTEXT DISCOVERY HELPERS
// ============================================

/**
 * Get context files from target directory up to workspace root.
 * Returns an array of context strings, from most general to most specific.
 */
async function getContextHierarchy(targetPath: string): Promise<string[]> {
  const contexts: string[] = [];
  const absolutePath = path.resolve(targetPath);
  const workspaceRoot = path.resolve("workspace");

  // Make sure we're within the workspace
  if (!absolutePath.startsWith(workspaceRoot)) {
    return [];
  }

  let current = absolutePath;

  // Walk up to workspace root, collecting context files
  while (current.startsWith(workspaceRoot)) {
    const contextFile = path.join(current, ".context.md");
    try {
      const content = await fs.readFile(contextFile, "utf-8");
      // Add parent contexts first (unshift), so local context comes last
      const relativePath = path.relative(workspaceRoot, current) || "(workspace root)";
      contexts.unshift(`## Context from: ${relativePath}\n\n${content}`);
    } catch {
      // No context file at this level, continue
    }

    if (current === workspaceRoot) break;
    current = path.dirname(current);
  }

  return contexts;
}

// ============================================
// TOOLS
// ============================================

// Tool 1: List directory contents
server.tool(
  "list_files",
  "List files and directories in a given path within the workspace",
  {
    path: z.string().describe("Directory path relative to workspace (use '.' for workspace root)"),
  },
  async ({ path: dirPath }) => {
    try {
      // Resolve relative to workspace
      const workspacePath = path.resolve("workspace", dirPath);
      const entries = await fs.readdir(workspacePath, { withFileTypes: true });

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

// Tool 2: Read file contents
server.tool(
  "read_file",
  "Read the contents of a file within the workspace",
  {
    path: z.string().describe("File path relative to workspace"),
  },
  async ({ path: filePath }) => {
    try {
      const workspacePath = path.resolve("workspace", filePath);
      const content = await fs.readFile(workspacePath, "utf-8");

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

// Tool 3: Write file contents
server.tool(
  "write_file",
  `Write content to a file within the workspace.

IMPORTANT: Before calling this tool, you should first call get_directory_context
to understand the naming conventions and required content format for the
target directory.`,
  {
    path: z.string().describe("File path relative to workspace"),
    content: z.string().describe("Content to write to the file"),
  },
  async ({ path: filePath, content }) => {
    try {
      const workspacePath = path.resolve("workspace", filePath);

      // Ensure parent directory exists
      const parentDir = path.dirname(workspacePath);
      await fs.mkdir(parentDir, { recursive: true });

      await fs.writeFile(workspacePath, content, "utf-8");

      return {
        content: [{
          type: "text" as const,
          text: `Successfully wrote ${content.length} characters to ${filePath}`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: Could not write file "${filePath}". ${error instanceof Error ? error.message : "Unknown error"}`,
        }],
        isError: true,
      };
    }
  }
);

// Tool 4: Get directory context (THE KEY DISCOVERY TOOL)
server.tool(
  "get_directory_context",
  `Get the context rules for a directory within the workspace.

This returns the .context.md file if one exists, plus any inherited context
from parent directories. Context is returned in order from most general
(workspace root) to most specific (target directory).

IMPORTANT: Always call this tool BEFORE creating or modifying files in a
directory to understand:
- Naming conventions (how files should be named)
- Required fields (what content must include)
- Templates (what format to use)
- Any special procedures or approval requirements`,
  {
    path: z.string().describe("Directory path relative to workspace (use '.' for workspace root)"),
  },
  async ({ path: dirPath }) => {
    try {
      const workspacePath = path.resolve("workspace", dirPath);
      const contexts = await getContextHierarchy(workspacePath);

      if (contexts.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No context rules found for "${dirPath}" or its parent directories.\n\nYou may proceed without specific conventions, but consider using sensible defaults.`,
          }],
        };
      }

      const header = `# Context Rules for: ${dirPath}\n\nThe following context rules apply to this directory. Rules are listed from most general (workspace-wide) to most specific (this directory). When rules conflict, more specific rules take precedence.\n\n---\n\n`;

      return {
        content: [{
          type: "text" as const,
          text: header + contexts.join("\n\n---\n\n"),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error getting context for "${dirPath}": ${error instanceof Error ? error.message : "Unknown error"}`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================
// START SERVER
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Workspace server running on stdio");
}

main().catch(console.error);
