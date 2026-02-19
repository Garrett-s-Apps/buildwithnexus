import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { NEXUS_HOME } from "../core/secrets.js";

const HISTORY_FILE = path.join(NEXUS_HOME, "shell_history");
const MAX_HISTORY = 1000;

export interface SlashCommand {
  name: string;
  description: string;
  handler: () => Promise<void>;
}

export class Repl {
  private rl: readline.Interface | null = null;
  private commands: Map<string, SlashCommand> = new Map();
  private onMessage: (text: string) => Promise<void>;
  private history: string[] = [];

  constructor(onMessage: (text: string) => Promise<void>) {
    this.onMessage = onMessage;
    this.loadHistory();
  }

  registerCommand(cmd: SlashCommand): void {
    this.commands.set(cmd.name, cmd);
  }

  private loadHistory(): void {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        this.history = fs.readFileSync(HISTORY_FILE, "utf-8")
          .split("\n")
          .filter(Boolean)
          .slice(-MAX_HISTORY);
      }
    } catch {
      // Ignore history load failures
    }
  }

  private saveHistory(): void {
    try {
      const dir = path.dirname(HISTORY_FILE);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(HISTORY_FILE, this.history.slice(-MAX_HISTORY).join("\n") + "\n", { mode: 0o600 });
    } catch {
      // Ignore history save failures
    }
  }

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.bold.cyan("nexus") + chalk.dim(" ❯ "),
      history: this.history,
      historySize: MAX_HISTORY,
      terminal: true,
    });

    this.rl.prompt();

    this.rl.on("line", async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl?.prompt();
        return;
      }

      this.history.push(trimmed);

      if (trimmed.startsWith("/")) {
        const parts = trimmed.slice(1).split(/\s+/);
        const cmdName = parts[0].toLowerCase();

        if (cmdName === "help") {
          this.showHelp();
          this.rl?.prompt();
          return;
        }

        if (cmdName === "exit" || cmdName === "quit") {
          this.stop();
          return;
        }

        const cmd = this.commands.get(cmdName);
        if (cmd) {
          try {
            await cmd.handler();
          } catch (err) {
            console.log(chalk.red(`  ✗ Command failed: ${(err as Error).message}`));
          }
          this.rl?.prompt();
          return;
        }

        console.log(chalk.yellow(`  Unknown command: /${cmdName}. Type /help for available commands.`));
        this.rl?.prompt();
        return;
      }

      // Free text — send to engine
      try {
        await this.onMessage(trimmed);
      } catch (err) {
        console.log(chalk.red(`  ✗ ${(err as Error).message}`));
      }
      this.rl?.prompt();
    });

    this.rl.on("close", () => {
      this.saveHistory();
      console.log(chalk.dim("\n  Session ended."));
      process.exit(0);
    });

    this.rl.on("SIGINT", () => {
      this.stop();
    });
  }

  showHelp(): void {
    console.log("");
    console.log(chalk.bold("  Available Commands:"));
    console.log(chalk.dim("  ─────────────────────────────────────────"));
    for (const [name, cmd] of this.commands) {
      console.log(`  ${chalk.cyan("/" + name.padEnd(14))} ${chalk.dim(cmd.description)}`);
    }
    console.log(`  ${chalk.cyan("/help".padEnd(15))} ${chalk.dim("Show this help message")}`);
    console.log(`  ${chalk.cyan("/exit".padEnd(15))} ${chalk.dim("Exit the shell")}`);
    console.log(chalk.dim("  ─────────────────────────────────────────"));
    console.log(chalk.dim("  Type anything else to chat with NEXUS"));
    console.log("");
  }

  write(text: string): void {
    // Clear current line, write text, re-prompt
    if (this.rl) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(text);
      this.rl.prompt(true);
    } else {
      console.log(text);
    }
  }

  stop(): void {
    this.saveHistory();
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
