import { Command } from "commander";
import chalk from "chalk";
import { input } from "@inquirer/prompts";
import { log } from "../ui/logger.js";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { loadConfig } from "../core/secrets.js";
import { isNexusRunning } from "../core/docker.js";
import { redact, redactError } from "../core/dlp.js";
import { checkServerHealth } from "../core/api.js";

const COS_PREFIX = chalk.bold.cyan("  Chief of Staff");
const YOU_PREFIX = chalk.bold.white("  You");
const DIVIDER = chalk.dim("  " + "─".repeat(56));

function formatResponse(text: string): string {
  // Wrap long lines and indent under the CoS prefix
  const lines = text.split("\n");
  return lines
    .map((line) => chalk.white("  " + line))
    .join("\n");
}

async function sendMessage(
  httpPort: number,
  message: string,
  source: string,
): Promise<string> {
  const res = await fetch(`http://localhost:${httpPort}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, source }),
  });

  if (!res.ok) {
    throw new Error(`Server returned status ${res.status}`);
  }

  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return parsed.response ?? parsed.message ?? text;
  } catch {
    return text;
  }
}

export const brainstormCommand = new Command("brainstorm")
  .description("Brainstorm an idea with the NEXUS Chief of Staff")
  .argument("[idea...]", "Your idea or question")
  .action(async (ideaWords: string[]) => {
    try {
      const config = loadConfig();
      if (!config) {
        log.error("No NEXUS configuration found. Run: buildwithnexus init");
        process.exit(1);
      }

      if (!(await isNexusRunning())) {
        log.error("NEXUS is not running. Start it with: buildwithnexus start");
        process.exit(1);
      }

      // Check server health
      const spinner = createSpinner("Connecting to NEXUS...");
      spinner.start();
      const healthOk = await checkServerHealth(config.httpPort);
      if (!healthOk) {
        fail(spinner, "NEXUS server is not healthy");
        log.warn("Check status: buildwithnexus status");
        process.exit(1);
      }
      succeed(spinner, "Connected to NEXUS");

      // Header
      console.log("");
      console.log(chalk.bold("  ╔══════════════════════════════════════════════════════════╗"));
      console.log(chalk.bold("  ║  ") + chalk.bold.cyan("NEXUS Brainstorm Session") + chalk.bold("                                ║"));
      console.log(chalk.bold("  ╠══════════════════════════════════════════════════════════╣"));
      console.log(chalk.bold("  ║  ") + chalk.dim("The Chief of Staff will discuss your idea with the".padEnd(55)) + chalk.bold("║"));
      console.log(chalk.bold("  ║  ") + chalk.dim("NEXUS team and share their recommendations.".padEnd(55)) + chalk.bold("║"));
      console.log(chalk.bold("  ║  ") + chalk.dim("Type 'exit' or 'quit' to end the session.".padEnd(55)) + chalk.bold("║"));
      console.log(chalk.bold("  ╚══════════════════════════════════════════════════════════╝"));
      console.log("");

      // Get initial idea
      let idea = ideaWords.length > 0 ? ideaWords.join(" ") : "";
      if (!idea) {
        idea = await input({
          message: "What would you like to brainstorm?",
        });
        if (!idea.trim()) {
          log.warn("No idea provided");
          return;
        }
      }

      // Conversation loop
      let turn = 0;
      let currentMessage = `[BRAINSTORM] The CEO wants to brainstorm the following idea. As Chief of Staff, discuss this with the relevant team members and report back with their recommendations. Be conversational, not formal. Idea: ${idea}`;

      while (true) {
        turn++;

        // Show what the user said
        if (turn === 1) {
          console.log(`${YOU_PREFIX}: ${chalk.white(idea)}`);
        }
        console.log(DIVIDER);

        // Send to NEXUS
        const thinking = createSpinner(
          turn === 1
            ? "Chief of Staff is consulting the team..."
            : "Chief of Staff is thinking...",
        );
        thinking.start();

        const response = await sendMessage(
          config.httpPort,
          currentMessage,
          "brainstorm",
        );

        thinking.stop();
        thinking.clear();

        // Display response
        console.log(`${COS_PREFIX}:`);
        console.log(formatResponse(redact(response)));
        console.log(DIVIDER);

        // Prompt for follow-up
        const followUp = await input({
          message: chalk.bold("You:"),
        });

        const trimmed = followUp.trim().toLowerCase();
        if (!trimmed || trimmed === "exit" || trimmed === "quit" || trimmed === "q") {
          console.log("");
          log.success("Brainstorm session ended");
          console.log(chalk.dim("    Run again anytime: buildwithnexus brainstorm"));
          console.log("");
          return;
        }

        // Show follow-up
        console.log(`${YOU_PREFIX}: ${chalk.white(followUp)}`);

        // Continue conversation with context
        currentMessage = `[BRAINSTORM FOLLOW-UP] The CEO responds: ${followUp}`;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") {
        // User pressed Ctrl+C during input
        console.log("");
        log.success("Brainstorm session ended");
        return;
      }
      const safeErr = redactError(err);
      log.error(`Brainstorm failed: ${safeErr.message}`);
      process.exit(1);
    }
  });
