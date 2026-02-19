import { Command } from "commander";
import chalk from "chalk";
import { input } from "@inquirer/prompts";
import { log } from "../ui/logger.js";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { loadConfig } from "../core/secrets.js";
import { isVmRunning } from "../core/qemu.js";
import { sshExec } from "../core/ssh.js";
import { redact, redactError, shellEscape } from "../core/dlp.js";

const AGENT_PREFIX = chalk.bold.green("  99 ❯");
const YOU_PREFIX = chalk.bold.white("  You");
const DIVIDER = chalk.dim("  " + "─".repeat(56));

// Homage to ThePrimeagen's 99 — AI pair-programming in the terminal.
// Routes through the NEXUS engine so the full 56-agent org executes your edits.

function formatAgentActivity(text: string): string {
  const lines = text.split("\n");
  return lines
    .map((line) => chalk.white("  " + line))
    .join("\n");
}

// Parse `@file` and `#rule` prefixes out of a user instruction.
// Returns the cleaned instruction and lists of attached files/rules.
function parsePrefixes(instruction: string): {
  cleaned: string;
  files: string[];
  rules: string[];
} {
  const files: string[] = [];
  const rules: string[] = [];
  const tokens = instruction.split(/\s+/);
  const remaining: string[] = [];

  for (const token of tokens) {
    if (token.startsWith("@") && token.length > 1) {
      files.push(token.slice(1));
    } else if (token.startsWith("#") && token.length > 1) {
      rules.push(token.slice(1));
    } else {
      remaining.push(token);
    }
  }

  return { cleaned: remaining.join(" "), files, rules };
}

async function sendToNexus(
  sshPort: number,
  instruction: string,
  files: string[],
  rules: string[],
  cwd: string,
): Promise<string> {
  const message = `[99] ${instruction}`;
  const payload = JSON.stringify({
    message,
    source: "99",
    context: { files, rules, cwd },
  });
  const escaped = shellEscape(payload);

  const { stdout, code } = await sshExec(
    sshPort,
    `curl -sf -X POST http://localhost:4200/message -H 'Content-Type: application/json' -d ${escaped}`,
  );

  if (code !== 0) {
    throw new Error("NEXUS engine returned a non-zero exit code");
  }

  try {
    const parsed = JSON.parse(stdout);
    return parsed.response ?? parsed.message ?? stdout;
  } catch {
    return stdout;
  }
}

export const ninetyNineCommand = new Command("99")
  .description("AI pair-programming session backed by the full NEXUS agent engine")
  .argument("[instruction...]", "What to build, edit, or debug")
  .option("--edit <file>", "AI-assisted edit for a specific file")
  .option("--search <query>", "Contextual codebase search")
  .option("--debug", "Debug current issue with NEXUS agent assistance")
  .action(async (instructionWords: string[], opts: {
    edit?: string;
    search?: string;
    debug?: boolean;
  }) => {
    try {
      const config = loadConfig();
      if (!config) {
        log.error("No NEXUS configuration found. Run: buildwithnexus init");
        process.exit(1);
      }

      if (!isVmRunning()) {
        log.error("VM is not running. Start it with: buildwithnexus start");
        process.exit(1);
      }

      const spinner = createSpinner("Connecting to NEXUS...");
      spinner.start();
      const { stdout: healthCheck, code: healthCode } = await sshExec(
        config.sshPort,
        "curl -sf http://localhost:4200/health",
      );
      if (healthCode !== 0 || !healthCheck.includes("ok")) {
        fail(spinner, "NEXUS server is not healthy");
        log.warn("Check status: buildwithnexus status");
        process.exit(1);
      }
      succeed(spinner, "Connected to NEXUS");

      console.log("");
      console.log(chalk.bold("  ╔══════════════════════════════════════════════════════════╗"));
      console.log(chalk.bold("  ║  ") + chalk.bold.green("/99 Pair Programming") + chalk.dim(" — powered by NEXUS") + chalk.bold("           ║"));
      console.log(chalk.bold("  ╠══════════════════════════════════════════════════════════╣"));
      console.log(chalk.bold("  ║  ") + chalk.dim("Describe what you want changed. NEXUS engineers".padEnd(55)) + chalk.bold("║"));
      console.log(chalk.bold("  ║  ") + chalk.dim("analyze and modify your code in real time.".padEnd(55)) + chalk.bold("║"));
      console.log(chalk.bold("  ║  ") + chalk.dim("Use @file to attach context, #rule to load rules.".padEnd(55)) + chalk.bold("║"));
      console.log(chalk.bold("  ║  ") + chalk.dim("Type 'exit' or 'quit' to end the session.".padEnd(55)) + chalk.bold("║"));
      console.log(chalk.bold("  ╚══════════════════════════════════════════════════════════╝"));
      console.log("");

      const cwd = process.cwd();

      // --edit mode: AI-assisted edit for a specific file
      if (opts.edit) {
        const instruction = instructionWords.join(" ") || await input({
          message: `What change should be made to ${opts.edit}?`,
        });
        const { cleaned, files, rules } = parsePrefixes(instruction);
        const fullInstruction = `Edit file ${opts.edit}: ${cleaned}`;

        console.log(`${YOU_PREFIX}: ${chalk.white(fullInstruction)}`);
        console.log(DIVIDER);

        const thinking = createSpinner("NEXUS engineers analyzing the file...");
        thinking.start();
        const response = await sendToNexus(config.sshPort, fullInstruction, [opts.edit, ...files], rules, cwd);
        thinking.stop();
        thinking.clear();

        console.log(`${AGENT_PREFIX}`);
        console.log(formatAgentActivity(redact(response)));
        console.log(DIVIDER);
        return;
      }

      // --search mode: contextual codebase search
      if (opts.search) {
        const fullInstruction = `Search the codebase for: ${opts.search}`;
        console.log(`${YOU_PREFIX}: ${chalk.white(fullInstruction)}`);
        console.log(DIVIDER);

        const thinking = createSpinner("Searching with NEXUS context...");
        thinking.start();
        const response = await sendToNexus(config.sshPort, fullInstruction, [], [], cwd);
        thinking.stop();
        thinking.clear();

        console.log(`${AGENT_PREFIX}`);
        console.log(formatAgentActivity(redact(response)));
        console.log(DIVIDER);
        return;
      }

      // --debug mode: root cause analysis
      if (opts.debug) {
        const fullInstruction = "Debug the current issue — analyze recent errors, identify the root cause, and propose a fix";
        console.log(`${YOU_PREFIX}: ${chalk.white(fullInstruction)}`);
        console.log(DIVIDER);

        const thinking = createSpinner("NEXUS debugger agent analyzing...");
        thinking.start();
        const response = await sendToNexus(config.sshPort, fullInstruction, [], [], cwd);
        thinking.stop();
        thinking.clear();

        console.log(`${AGENT_PREFIX}`);
        console.log(formatAgentActivity(redact(response)));
        console.log(DIVIDER);
        return;
      }

      // Interactive REPL mode (default)
      let initialInstruction = instructionWords.length > 0 ? instructionWords.join(" ") : "";

      if (!initialInstruction) {
        initialInstruction = await input({
          message: chalk.green("99 ❯"),
        });
        if (!initialInstruction.trim()) {
          log.warn("No instruction provided");
          return;
        }
      }

      let turn = 0;
      let currentInstruction = initialInstruction;

      while (true) {
        turn++;

        const { cleaned, files, rules } = parsePrefixes(currentInstruction);
        const display = currentInstruction;
        const nexusInstruction = cleaned || currentInstruction;

        if (turn === 1) {
          console.log(`${YOU_PREFIX}: ${chalk.white(display)}`);
        }

        if (files.length > 0) {
          console.log(chalk.dim(`  Attaching: ${files.join(", ")}`));
        }
        if (rules.length > 0) {
          console.log(chalk.dim(`  Rules: ${rules.join(", ")}`));
        }

        console.log(DIVIDER);

        const thinking = createSpinner(
          turn === 1
            ? "NEXUS agents analyzing and implementing..."
            : "NEXUS agents processing...",
        );
        thinking.start();

        const response = await sendToNexus(config.sshPort, nexusInstruction, files, rules, cwd);

        thinking.stop();
        thinking.clear();

        console.log(`${AGENT_PREFIX}`);
        console.log(formatAgentActivity(redact(response)));
        console.log(DIVIDER);

        const followUp = await input({
          message: chalk.green("99 ❯"),
        });

        const trimmed = followUp.trim().toLowerCase();
        if (!trimmed || trimmed === "exit" || trimmed === "quit" || trimmed === "q") {
          console.log("");
          log.success("/99 session ended");
          console.log(chalk.dim("    Run again: buildwithnexus 99"));
          console.log("");
          return;
        }

        console.log(`${YOU_PREFIX}: ${chalk.white(followUp)}`);
        currentInstruction = followUp;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") {
        console.log("");
        log.success("/99 session ended");
        return;
      }
      const safeErr = redactError(err);
      log.error(`/99 failed: ${safeErr.message}`);
      process.exit(1);
    }
  });
