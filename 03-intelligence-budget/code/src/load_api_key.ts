export async function load_api_keys() {
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

}

// import { load_api_keys } from './load_api_key.js';