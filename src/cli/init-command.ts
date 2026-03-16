// src/cli/init-command.ts
import * as readline from 'readline';
import {
  loadKeys,
  saveKeys,
  ensureHome,
  generateMasterSecret,
  maskKey,
  type NexusKeys,
} from '../core/secrets.js';

export async function deepAgentsInitCommand() {
  const inputHandler = new InputHandler();

  ensureHome();

  // Check for cached keys in ~/.buildwithnexus/.env.keys
  let existingKeys: NexusKeys | null = null;
  try {
    existingKeys = loadKeys();
  } catch {
    // tampered or unreadable — fall through to re-prompt
  }

  if (existingKeys) {
    console.log('\nKeys found in ~/.buildwithnexus/.env.keys:');
    if (existingKeys.ANTHROPIC_API_KEY) {
      console.log(`  ANTHROPIC_API_KEY: ${maskKey(existingKeys.ANTHROPIC_API_KEY)}`);
    }
    if (existingKeys.OPENAI_API_KEY) {
      console.log(`  OPENAI_API_KEY: ${maskKey(existingKeys.OPENAI_API_KEY)}`);
    }
    if (existingKeys.GOOGLE_API_KEY) {
      console.log(`  GOOGLE_API_KEY: ${maskKey(existingKeys.GOOGLE_API_KEY)}`);
    }

    const choice = await inputHandler.askQuestion(
      "\nPress Enter to use cached keys, or type 'new' to reconfigure: "
    );

    if (choice.trim().toLowerCase() !== 'new') {
      // Load cached keys into process.env for the current session
      process.env.ANTHROPIC_API_KEY = existingKeys.ANTHROPIC_API_KEY || '';
      if (existingKeys.OPENAI_API_KEY) process.env.OPENAI_API_KEY = existingKeys.OPENAI_API_KEY;
      if (existingKeys.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = existingKeys.GOOGLE_API_KEY;
      console.log('Using cached keys.');
      inputHandler.close();
      return;
    }
  }

  console.log(
    '\nPlease provide your LLM API keys:\n' +
    '(Stored securely in ~/.buildwithnexus/.env.keys)\n'
  );

  // Collect API keys
  const anthropicKey = await inputHandler.askQuestion(
    'ANTHROPIC_API_KEY (Claude - optional, press Enter to skip): '
  );

  const openaiKey = await inputHandler.askQuestion(
    'OPENAI_API_KEY (GPT - optional, press Enter to skip): '
  );

  const googleKey = await inputHandler.askQuestion(
    'GOOGLE_API_KEY (Gemini - optional, press Enter to skip): '
  );

  if (!anthropicKey && !openaiKey && !googleKey) {
    const anthropicStatus = anthropicKey ? 'provided' : 'empty';
    const openaiStatus = openaiKey ? 'provided' : 'empty';
    const googleStatus = googleKey ? 'provided' : 'empty';
    console.log(
      `Error: API keys status: Anthropic [${anthropicStatus}], OpenAI [${openaiStatus}], Google [${googleStatus}]. Please provide at least one.`
    );
    inputHandler.close();
    return;
  }

  const masterSecret = generateMasterSecret();

  const keys: NexusKeys = {
    ANTHROPIC_API_KEY: anthropicKey,
    OPENAI_API_KEY: openaiKey || undefined,
    GOOGLE_API_KEY: googleKey || undefined,
    NEXUS_MASTER_SECRET: masterSecret,
  };

  saveKeys(keys);

  // Load into process.env for the current session
  if (anthropicKey) process.env.ANTHROPIC_API_KEY = anthropicKey;
  if (openaiKey) process.env.OPENAI_API_KEY = openaiKey;
  if (googleKey) process.env.GOOGLE_API_KEY = googleKey;

  console.log('Configuration saved to ~/.buildwithnexus/.env.keys and loaded into environment.');
  inputHandler.close();
}

class InputHandler {
  private inputLines: string[] = [];
  private lineIndex: number = 0;
  private isSetup: boolean = false;
  private rl: readline.Interface | null = null;

  setupInputHandling(): Promise<void> {
    return new Promise((resolve) => {
      if (this.isSetup) {
        resolve();
        return;
      }

      this.isSetup = true;

      // Check if stdin is a TTY (interactive) or piped
      if (process.stdin.isTTY) {
        // Interactive mode - create a single reusable readline interface
        this.rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        resolve();
      } else {
        // Piped input mode - collect all lines first
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: false,
        });

        rl.on('line', (line) => {
          this.inputLines.push(line);
        });

        rl.on('close', () => {
          resolve();
        });
      }
    });
  }

  async askQuestion(prompt: string): Promise<string> {
    await this.setupInputHandling();

    if (process.stdin.isTTY) {
      // Interactive mode - reuse the single readline interface
      return new Promise((resolve) => {
        this.rl!.question(prompt, (answer) => {
          resolve(answer);
        });
      });
    } else {
      // Piped input mode - use pre-collected lines
      process.stdout.write(prompt);
      const answer = this.inputLines[this.lineIndex] || '';
      this.lineIndex++;
      console.log(answer); // Echo the answer for visibility
      return answer;
    }
  }

  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
