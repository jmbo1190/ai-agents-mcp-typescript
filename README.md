# AI Agents with Model Context Protocol & TypeScript - Code Examples

This repository contains code examples for the Coursera course "AI Agents with Model Context Protocol & TypeScript."

## Prerequisites

- Node.js 18+ 
- npm
- An OpenAI API key (set in `.env` file)

## Setup

Each module has its own `code/` directory. To set up any module:

```bash
cd <module>/code
npm install
cp .env.example .env  # Then add your OPENAI_API_KEY
```

---

## Course Structure & Code Mapping

### Module 1: Getting Started with Model Context Protocol (MCP) for AI Agents

| Item | Type | Code Files |
|------|------|------------|
| Why Do We Need Model Context Protocol? | Video | — |
| Model Context Protocol & AI Problem Solving with Tools | Video | — |
| MCP Allows AI to Communicate with the Computer | Video | — |
| AI @ Work - What My Work with AI Looks Like | Video | — |
| My AI Tools | Reading | — |
| Learning More & Staying Connected | Reading | — |

*Module 1 is conceptual introduction — no code exercises.*

---

### Module 2: AI Agent Loops & Model Context Protocol

| Item | Type | Code Files | Run Command |
|------|------|------------|-------------|
| Model Context Protocol: Syntax, Semantics, Timing | Video | — | — |
| Model Context Protocol & AI Agents | Video | — | — |
| What is an MCP Server? | Video | — | — |
| Tool Specifications | Video | — | — |
| **Building Your First MCP Server** | Ungraded Plugin | `01-intro-to-mcp-agents/code/server.ts` | `npm run server` |
| **Building Your First MCP AI Agent** | Ungraded Plugin | `01-intro-to-mcp-agents/code/agent.ts`<br>`01-intro-to-mcp-agents/code/llm.ts` | `npm run agent` |
| Agents Talking to Tools vs. Tools with AI | Video | — | — |

**Code Location:** `01-intro-to-mcp-agents/code/`

**Key Files:**
| Path | Description |
|------|-------------|
| `01-intro-to-mcp-agents/code/server.ts` | Basic MCP tool server with `list_files` and `read_file` tools |
| `01-intro-to-mcp-agents/code/agent.ts` | Agent loop implementation (PERCEIVE→DECIDE→ACT→OBSERVE) |
| `01-intro-to-mcp-agents/code/llm.ts` | LLM integration utilities (OpenAI/Anthropic) |
| `01-intro-to-mcp-agents/code/test-server.ts` | Tests server tools directly without an agent |

**Commands:**
```bash
cd 01-intro-to-mcp-agents/code
npm install
npm run server       # Start the basic MCP server
npm run agent        # Run the basic agent
npm run test-server  # Test server tools directly
```

---

### Module 3: Building AI Agents with Model Context Protocol

| Item | Type | Code Files | Run Command |
|------|------|------------|-------------|
| Resources | Video | — | — |
| **Teaching Agents to Use Tools** | Ungraded Plugin | `01-intro-to-mcp-agents/code/workspace-server.ts` | `npm run workspace-server` |
| **Teaching Agents to Seek Help** | Ungraded Plugin | `01-intro-to-mcp-agents/code/workspace-server.ts` | `npm run workspace-server` |
| **Helping Agents Find Guidance** | Ungraded Plugin | `01-intro-to-mcp-agents/code/workspace-server.ts` | `npm run workspace-server` |
| **Helping AI Agents on the Fly** | Ungraded Plugin | `01-intro-to-mcp-agents/code/workspace-server.ts` | `npm run workspace-server` |
| **Helping AI Agents Discover Workspace-related Guidance** | Ungraded Plugin | `01-intro-to-mcp-agents/code/workspace-server.ts`<br>`01-intro-to-mcp-agents/code/workspace-agent.ts` | `npm run workspace-agent` |

**Code Location:** `01-intro-to-mcp-agents/code/`

**Key Files:**
| Path | Description |
|------|-------------|
| `01-intro-to-mcp-agents/code/workspace-server.ts` | Enhanced server with workspace-aware tools and context discovery |
| `01-intro-to-mcp-agents/code/workspace-agent.ts` | Agent that works within a defined workspace with context awareness |
| `01-intro-to-mcp-agents/code/workspace/` | Sample workspace with `.context.md` files for testing |

**Commands:**
```bash
cd 01-intro-to-mcp-agents/code
npm run workspace-server  # Start workspace-aware server
npm run workspace-agent   # Run workspace agent with context discovery
```

---

### Module 4: Robust Error Handling Techniques for AI Agents

| Item | Type | Code Files | Run Command |
|------|------|------------|-------------|
| **Responses are More than Data** | Ungraded Plugin | `02-failing-forward/code/src/expense-server.ts` | `npm run server` |
| **Designing Errors to Help AI Agents** | Ungraded Plugin | `02-failing-forward/code/src/expense-server.ts` | `npm run server` |
| **Errors in Complex Workflows** | Ungraded Plugin | `02-failing-forward/code/src/expense-server.ts` | `npm run server` |
| **Minimizing AI Agent Cognitive Burden from Error Recovery** | Ungraded Plugin | `02-failing-forward/code/src/expense-server.ts` | `npm run server` |
| **Helping AI Agents Find Alternative Paths to Fix Errors** | Ungraded Plugin | `02-failing-forward/code/src/expense-server.ts` | `npm run server` |

**Code Location:** `02-failing-forward/code/`

**Key Files:**
| Path | Description |
|------|-------------|
| `02-failing-forward/code/src/expense-server.ts` | MCP server demonstrating all Failing Forward patterns |
| `02-failing-forward/code/src/expense-agent.ts` | Agent that learns from errors to complete expense tasks |
| `02-failing-forward/code/src/test-failing-forward.ts` | Comprehensive tests for all failing forward patterns |

**Commands:**
```bash
cd 02-failing-forward/code
npm install
npm run server  # Start the expense server
npm run agent   # Run the expense agent
npm run test    # Run failing forward tests
```

**Pattern Mapping:**
| Coursera Item | Pattern | Code Location |
|---------------|---------|---------------|
| Responses are More than Data | Response-as-Instruction | `expense-server.ts` - `next_action`, `hint` fields |
| Designing Errors to Help AI Agents | Errors as Curriculum | `expense-server.ts` - `submit_expense` validation |
| Errors in Complex Workflows | Error Chains | `expense-server.ts` - `request_late_expense_approval` → `check_approval_status` |
| Minimizing AI Agent Cognitive Burden | Pre-filled Parameters | `expense-server.ts` - `suggested_params` in errors |
| Helping AI Agents Find Alternative Paths | Alternative Actions | `expense-server.ts` - `alternatives` array |

---

### Module 5: Faster, More Predictable, More Capable AI Agents

| Item | Type | Code Files | Run Command |
|------|------|------------|-------------|
| **Managing AI Agent Cognitive Load** | Ungraded Plugin | `03-intelligence-budget/code/src/agent-heavy-server.ts`<br>`03-intelligence-budget/code/src/tool-heavy-server.ts` | `npm run agent-heavy`<br>`npm run tool-heavy` |
| **Predictability, Lower Cost, Speed: Scripted Orchestration** | Ungraded Plugin | `03-intelligence-budget/code/src/scripted-orchestration-server.ts` | — |
| Prompts and MCP | Video | — | — |
| **Self-Prompting: Adding Reasoning to Tools** | Ungraded Plugin | `03-intelligence-budget/code/src/self-prompting-server.ts` | — |
| **AI Agent Tool Design for Common Errors** | Ungraded Plugin | `03-intelligence-budget/code/src/validate-at-source-server.ts` | — |
| AI Agents, MCP, & Identity / Security | Video | — | — |
| Wrapping Up | Video | — | — |
| Final Assessment | Assignment | — | — |

**Code Location:** `03-intelligence-budget/code/`

**Key Files:**
| Path | Description |
|------|-------------|
| `03-intelligence-budget/code/src/agent-heavy-server.ts` | Minimal tools approach - agent does most processing |
| `03-intelligence-budget/code/src/tool-heavy-server.ts` | Rich tools approach - tools pre-process data for agent |
| `03-intelligence-budget/code/src/hybrid-server.ts` | Balanced approach combining both strategies |
| `03-intelligence-budget/code/src/scripted-orchestration-server.ts` | Tools that let agent write scripts for batch operations |
| `03-intelligence-budget/code/src/self-prompting-server.ts` | Tools that make isolated LLM calls for semantic reasoning |
| `03-intelligence-budget/code/src/validate-at-source-server.ts` | Tools with layered validation (format → business → semantic) |
| `03-intelligence-budget/code/src/database.ts` | Shared mock database used by all server examples |
| `03-intelligence-budget/code/src/test-all.ts` | Comprehensive test suite comparing all approaches |

**Commands:**
```bash
cd 03-intelligence-budget/code
npm install
npm run agent-heavy  # Start agent-heavy server
npm run tool-heavy   # Start tool-heavy server
npm run hybrid       # Start hybrid server
npm run test         # Run comparison tests
```

**Pattern Mapping:**
| Coursera Item | Pattern | Code Location |
|---------------|---------|---------------|
| Managing AI Agent Cognitive Load | Intelligence Budget | `agent-heavy-server.ts` vs `tool-heavy-server.ts` |
| Predictability, Lower Cost, Speed | Scripted Orchestration | `scripted-orchestration-server.ts` - `execute_script` tool |
| Self-Prompting: Adding Reasoning | Self-Prompting | `self-prompting-server.ts` - isolated LLM calls in tools |
| AI Agent Tool Design for Common Errors | Validate at Source | `validate-at-source-server.ts` - layered validation stack |

---

## Quick Reference: Coursera Item → Code File

| Module | Coursera Item | Code File |
|--------|---------------|-----------|
| 2 | Building Your First MCP Server | `01-intro-to-mcp-agents/code/server.ts` |
| 2 | Building Your First MCP AI Agent | `01-intro-to-mcp-agents/code/agent.ts` |
| 3 | Teaching Agents to Use Tools | `01-intro-to-mcp-agents/code/workspace-server.ts` |
| 3 | Teaching Agents to Seek Help | `01-intro-to-mcp-agents/code/workspace-server.ts` |
| 3 | Helping Agents Find Guidance | `01-intro-to-mcp-agents/code/workspace-server.ts` |
| 3 | Helping AI Agents on the Fly | `01-intro-to-mcp-agents/code/workspace-server.ts` |
| 3 | Helping AI Agents Discover Workspace-related Guidance | `01-intro-to-mcp-agents/code/workspace-agent.ts` |
| 4 | Responses are More than Data | `02-failing-forward/code/src/expense-server.ts` |
| 4 | Designing Errors to Help AI Agents | `02-failing-forward/code/src/expense-server.ts` |
| 4 | Errors in Complex Workflows | `02-failing-forward/code/src/expense-server.ts` |
| 4 | Minimizing AI Agent Cognitive Burden from Error Recovery | `02-failing-forward/code/src/expense-server.ts` |
| 4 | Helping AI Agents Find Alternative Paths to Fix Errors | `02-failing-forward/code/src/expense-server.ts` |
| 5 | Managing AI Agent Cognitive Load | `03-intelligence-budget/code/src/agent-heavy-server.ts`<br>`03-intelligence-budget/code/src/tool-heavy-server.ts` |
| 5 | Predictability, Lower Cost, Speed: Scripted Orchestration | `03-intelligence-budget/code/src/scripted-orchestration-server.ts` |
| 5 | Self-Prompting: Adding Reasoning to Tools | `03-intelligence-budget/code/src/self-prompting-server.ts` |
| 5 | AI Agent Tool Design for Common Errors | `03-intelligence-budget/code/src/validate-at-source-server.ts` |

---

## Environment Setup

Create a `.env` file in each module's `code/` directory:

```env
OPENAI_API_KEY=your-api-key-here
```

---

## Project Structure

```
code-repo/
├── README.md
│
├── 01-intro-to-mcp-agents/
│   └── code/
│       ├── server.ts              # Module 2: Building Your First MCP Server
│       ├── agent.ts               # Module 2: Building Your First MCP AI Agent
│       ├── llm.ts                 # LLM utilities
│       ├── workspace-server.ts    # Module 3: All workspace/context items
│       ├── workspace-agent.ts     # Module 3: Workspace-related Guidance
│       ├── test-server.ts         # Server testing
│       └── workspace/             # Sample workspace with .context.md files
│
├── 02-failing-forward/
│   └── code/
│       └── src/
│           ├── expense-server.ts       # Module 4: All error handling items
│           ├── expense-agent.ts        # Agent for expense workflows
│           └── test-failing-forward.ts # Pattern tests
│
└── 03-intelligence-budget/
    └── code/
        └── src/
            ├── agent-heavy-server.ts          # Module 5: Managing Cognitive Load
            ├── tool-heavy-server.ts           # Module 5: Managing Cognitive Load
            ├── hybrid-server.ts               # Balanced approach
            ├── scripted-orchestration-server.ts # Module 5: Scripted Orchestration
            ├── self-prompting-server.ts       # Module 5: Self-Prompting
            ├── validate-at-source-server.ts   # Module 5: Tool Design for Errors
            ├── database.ts                    # Shared mock database
            └── test-all.ts                    # Comparison tests
```

---

## License

MIT
