/**
 * LLM Abstraction Layer - Tutorial 02
 *
 * Provides a unified interface for different LLM providers.
 * Supports OpenAI, Anthropic (Claude), and Google (Gemini).
 */

// === Types ===

export interface Message {
   role: "user" | "assistant" | "system";
   content: string;
}

export interface Tool {
   name: string;
   description: string;
   inputSchema: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
   };
}

export interface ToolCall {
   name: string;
   arguments: Record<string, unknown>;
}

export interface LLMResponse {
   content: string | null;
   toolCalls: ToolCall[];
}

export interface LLMProvider {
   chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;
}

// === Providers ===

export class AnthropicProvider implements LLMProvider {
   private readonly apiKey: string;
   private readonly model: string;

   constructor(apiKey: string, model: string = "claude-sonnet-4-20250514") {
      this.apiKey = apiKey;
      this.model = model;
   }

   async chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
      const systemMessage = messages.find((m) => m.role === "system");
      const otherMessages = messages.filter((m) => m.role !== "system");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
         method: "POST",
         headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
         },
         body: JSON.stringify({
            model: this.model,
            max_tokens: 4096,
            system: systemMessage?.content,
            messages: otherMessages.map((m) => ({
               role: m.role,
               content: m.content,
            })),
            tools: tools?.map((t) => ({
               name: t.name,
               description: t.description,
               input_schema: t.inputSchema,
            })),
         }),
      });

      if (!response.ok) {
         const error = await response.text();
         throw new Error(`Anthropic API error: ${response.status} - ${error}`);
      }

      const data = await response.json();

      let content: string | null = null;
      const toolCalls: ToolCall[] = [];

      for (const block of data.content) {
         if (block.type === "text") {
            content = block.text;
         } else if (block.type === "tool_use") {
            toolCalls.push({
               name: block.name,
               arguments: block.input,
            });
         }
      }

      return { content, toolCalls };
   }
}

export class OpenAIProvider implements LLMProvider {
   private readonly apiKey: string;
   private readonly model: string;

   constructor(apiKey: string, model: string = "gpt-4o") {
      this.apiKey = apiKey;
      this.model = model;
   }

   async chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
      const body: Record<string, unknown> = {
         model: this.model,
         messages: messages.map((m) => ({ role: m.role, content: m.content })),
      };

      if (tools && tools.length > 0) {
         body.tools = tools.map((t) => ({
            type: "function",
            function: {
               name: t.name,
               description: t.description,
               parameters: t.inputSchema,
            },
         }));
      }

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
         method: "POST",
         headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
         },
         body: JSON.stringify(body),
      });

      if (!response.ok) {
         const error = await response.text();
         throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const choice = data.choices[0];
      const message = choice.message;

      const toolCalls: ToolCall[] = [];
      if (message.tool_calls) {
         for (const tc of message.tool_calls) {
            toolCalls.push({
               name: tc.function.name,
               arguments: JSON.parse(tc.function.arguments),
            });
         }
      }

      return {
         content: message.content,
         toolCalls,
      };
   }
}

export class GeminiProvider implements LLMProvider {
   private readonly apiKey: string;
   private readonly model: string;

   constructor(apiKey: string, model: string = "gemini-1.5-flash") {
      this.apiKey = apiKey;
      this.model = model;
   }

   async chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

      const contents = messages
         .filter((m) => m.role !== "system")
         .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
         }));

      const systemInstruction = messages.find((m) => m.role === "system");

      const body: Record<string, unknown> = {
         contents,
      };

      if (systemInstruction) {
         body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
      }

      if (tools && tools.length > 0) {
         body.tools = [
            {
               functionDeclarations: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema,
               })),
            },
         ];
      }

      const response = await fetch(url, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify(body),
      });

      if (!response.ok) {
         const error = await response.text();
         throw new Error(`Gemini API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const candidate = data.candidates[0];
      const parts = candidate.content.parts;

      let content: string | null = null;
      const toolCalls: ToolCall[] = [];

      for (const part of parts) {
         if (part.text) {
            content = part.text;
         } else if (part.functionCall) {
            toolCalls.push({
               name: part.functionCall.name,
               arguments: part.functionCall.args || {},
            });
         }
      }

      return { content, toolCalls };
   }
}

// === Factory ===

export async function createLLMFromEnv(): Promise<LLMProvider> {

   if (process.env.ANTHROPIC_API_KEY) {
      console.log("Using Anthropic Claude");
      return new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
   }
   if (process.env.GEMINI_API_KEY) {
      console.log("Using Google Gemini");
      return new GeminiProvider(process.env.GEMINI_API_KEY);
   }
   if (!process.env.OPENAI_API_KEY) {
      // retrieve API key from keyring if available (optional, requires keytar package)
      try {
         const keytar = await import("keytar");
         const storedKey = await keytar.default.getPassword("mcp-agent", "openai-api-key");
         if (storedKey) {
            console.log("Using OpenAI API key from keyring");
            // store the API key in an environment variable
            process.env.OPENAI_API_KEY = storedKey;
         }
      } catch { }
      if (!process.env.OPENAI_API_KEY) {
         // prompt the user to enter an API key and await input
         const readline = await import("node:readline");
         const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
         });

         const question = (query: string) =>
            new Promise<string>((resolve) => rl.question(query, resolve));

         const apiKey = await question("Enter your OpenAI API key: ");
         rl.close();

         if (apiKey.trim()) {
            console.log("Using OpenAI API key from user input");
            process.env.OPENAI_API_KEY = apiKey.trim();
            // store the API key in keyring for future use
            try {
               const keytar = await import("keytar");
               await keytar.default.setPassword("mcp-agent", "openai-api-key", apiKey.trim());
               console.log("OpenAI API key saved to keyring for future use");
            } catch { }
         } else {
            throw new Error("No API key provided");
         }
      }
   }

   if (process.env.OPENAI_API_KEY) {
      console.log("Using OpenAI");
      return new OpenAIProvider(process.env.OPENAI_API_KEY);
   }
   throw new Error(
      "No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY",
   );
}
