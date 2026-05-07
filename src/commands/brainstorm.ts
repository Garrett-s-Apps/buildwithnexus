import { Command } from "commander";
import chalk from "chalk";
import { input } from "@inquirer/prompts";
import { log } from "../ui/logger.js";
import { buildRunPayload, checkServerHealth } from "../core/api.js";
import { parseSSEStream } from "../core/sse-parser.js";
import { startBackend } from "../core/docker.js";
import { redact, redactError } from "../core/dlp.js";

const CPO_PREFIX = chalk.bold.cyan("  CPO");
const YOU_PREFIX = chalk.bold.white("  You");
const DIVIDER = chalk.dim("  " + "─".repeat(56));

async function waitForBackend(backendUrl: string): Promise<boolean> {
  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (await checkServerHealth(backendUrl)) return true;
  }
  return false;
}

async function runBrainstormTurn(
  backendUrl: string,
  message: string,
): Promise<string> {
  const response = await fetch(`${backendUrl}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRunPayload(
      message,
      "brainstorm",
      "Generate ideas, considerations, and suggestions. Be conversational and concise.",
    )),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status}`);
  }

  const { run_id } = (await response.json()) as { run_id: string };

  const streamResponse = await fetch(`${backendUrl}/api/stream/${run_id}`, {
    signal: AbortSignal.timeout(120000),
  });

  if (!streamResponse.ok) {
    throw new Error(`Stream error: ${streamResponse.status}`);
  }

  const reader = streamResponse.body?.getReader();
  if (!reader) throw new Error("No response body");

  let result = "";
  for await (const parsed of parseSSEStream(reader)) {
    const type = parsed.type;
    const data = parsed.data as Record<string, string>;

    if (type === "done" || type === "final_result") {
      result = data["result"] || data["summary"] || result;
      break;
    } else if (type === "error") {
      throw new Error(data["error"] || "Unknown error from backend");
    } else if (type === "thinking") {
      // silent — shown via spinner
    } else {
      const content = data["content"] || data["summary"] || "";
      if (content) result += content;
    }
  }

  return result;
}

export const brainstormCommand = new Command("brainstorm")
  .description("Brainstorm an idea with the NEXUS CPO")
  .argument("[idea...]", "Your idea or question")
  .action(async (ideaWords: string[]) => {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:4200";

    try {
      // Ensure backend is running
      if (!(await checkServerHealth(backendUrl))) {
        log.step("Backend not running — starting...");
        await startBackend();
        const ready = await waitForBackend(backendUrl);
        if (!ready) {
          log.error("Backend failed to start. Run: buildwithnexus server");
          process.exit(1);
        }
      }

      console.log("");
      console.log(chalk.bold("  ╔══════════════════════════════════════════════════════════╗"));
      console.log(chalk.bold("  ║  ") + chalk.bold.cyan("NEXUS Brainstorm Session") + chalk.bold("                                ║"));
      console.log(chalk.bold("  ╠══════════════════════════════════════════════════════════╣"));
      console.log(chalk.bold("  ║  ") + chalk.dim("The CPO will discuss your idea and share".padEnd(55)) + chalk.bold("║"));
      console.log(chalk.bold("  ║  ") + chalk.dim("recommendations. Type 'exit' to end.".padEnd(55)) + chalk.bold("║"));
      console.log(chalk.bold("  ╚══════════════════════════════════════════════════════════╝"));
      console.log("");

      let idea = ideaWords.length > 0 ? ideaWords.join(" ") : "";
      if (!idea) {
        idea = await input({ message: "What would you like to brainstorm?" });
        if (!idea.trim()) {
          log.warn("No idea provided");
          return;
        }
      }

      const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
      let currentQuestion = idea;

      while (true) {
        console.log(`${YOU_PREFIX}: ${chalk.white(currentQuestion)}`);
        console.log(DIVIDER);

        const taskWithHistory = conversationHistory.length === 0
          ? currentQuestion
          : conversationHistory.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")
            + `\n\nUser: ${currentQuestion}`;

        process.stdout.write(chalk.dim("  CPO is thinking...\r"));

        const responseText = await runBrainstormTurn(backendUrl, taskWithHistory);
        const clean = redact(responseText.trim());

        process.stdout.write("                              \r");
        console.log(`${CPO_PREFIX}:`);
        clean.split("\n").forEach(line => console.log(chalk.white("  " + line)));
        console.log(DIVIDER);

        conversationHistory.push({ role: "user", content: currentQuestion });
        conversationHistory.push({ role: "assistant", content: clean });

        const followUp = await input({ message: chalk.bold("You:") });
        const trimmed = followUp.trim().toLowerCase();

        if (!trimmed || trimmed === "exit" || trimmed === "quit" || trimmed === "q") {
          console.log("");
          log.success("Brainstorm session ended");
          console.log(chalk.dim("    Run again anytime: buildwithnexus brainstorm"));
          console.log("");
          return;
        }

        currentQuestion = followUp.trim();
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") {
        console.log("");
        log.success("Brainstorm session ended");
        return;
      }
      const safeErr = redactError(err);
      log.error(`Brainstorm failed: ${safeErr.message}`);
      process.exit(1);
    }
  });
