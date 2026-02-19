import { Command } from "commander";
import chalk from "chalk";
import { log } from "../ui/logger.js";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { loadConfig } from "../core/secrets.js";
import { isVmRunning } from "../core/qemu.js";
import { sshExec } from "../core/ssh.js";
import { checkHealth } from "../core/health.js";
import { redact, redactError, shellEscape } from "../core/dlp.js";
import { Repl } from "../ui/repl.js";
import { EventStream, formatEvent } from "../core/event-stream.js";

async function sendMessage(sshPort: number, message: string): Promise<string> {
  const payload = JSON.stringify({ message, source: "shell" });
  const escaped = shellEscape(payload);
  const { stdout, code } = await sshExec(
    sshPort,
    `curl -sf -X POST http://localhost:4200/message -H 'Content-Type: application/json' -d ${escaped}`,
  );
  if (code !== 0) throw new Error("Server returned a non-zero exit code");
  try {
    const parsed = JSON.parse(stdout);
    return parsed.response ?? parsed.message ?? stdout;
  } catch {
    return stdout;
  }
}

function showShellBanner(health: { vmRunning: boolean; sshReady: boolean; dockerReady: boolean; serverHealthy: boolean; tunnelUrl: string | null }): void {
  const check = chalk.green("✓");
  const cross = chalk.red("✗");

  console.log("");
  console.log(chalk.bold("  ╔══════════════════════════════════════════════════════════╗"));
  console.log(chalk.bold("  ║  ") + chalk.bold.cyan("NEXUS Interactive Shell") + chalk.bold("                                 ║"));
  console.log(chalk.bold("  ╠══════════════════════════════════════════════════════════╣"));
  console.log(chalk.bold("  ║  ") + `${health.vmRunning ? check : cross} VM    ${health.sshReady ? check : cross} SSH    ${health.dockerReady ? check : cross} Docker    ${health.serverHealthy ? check : cross} Engine`.padEnd(55) + chalk.bold("║"));
  if (health.tunnelUrl) {
    console.log(chalk.bold("  ║  ") + chalk.dim(`Tunnel: ${health.tunnelUrl}`.padEnd(55)) + chalk.bold("║"));
  }
  console.log(chalk.bold("  ╠══════════════════════════════════════════════════════════╣"));
  console.log(chalk.bold("  ║  ") + chalk.dim("Type naturally to chat · /help for commands".padEnd(55)) + chalk.bold("║"));
  console.log(chalk.bold("  ╚══════════════════════════════════════════════════════════╝"));
  console.log("");
}

async function getAgentList(sshPort: number): Promise<string> {
  try {
    const { stdout, code } = await sshExec(sshPort, "curl -sf http://localhost:4200/agents");
    if (code !== 0) return "Could not retrieve agent list";
    const agents = JSON.parse(stdout);
    if (!Array.isArray(agents)) return stdout;
    const lines: string[] = [""];
    lines.push(chalk.bold("  Registered Agents:"));
    lines.push(chalk.dim("  ─────────────────────────────────────────"));
    for (const agent of agents) {
      const name = agent.name ?? agent.id ?? "unknown";
      const role = agent.role ?? "";
      const status = agent.status === "active" ? chalk.green("●") : chalk.dim("○");
      lines.push(`  ${status} ${chalk.bold(name.padEnd(24))} ${chalk.dim(role)}`);
    }
    lines.push("");
    return lines.join("\n");
  } catch {
    return "  Could not retrieve agent list";
  }
}

async function getStatus(sshPort: number): Promise<string> {
  try {
    const vmRunning = isVmRunning();
    const health = await checkHealth(sshPort, vmRunning);
    const check = chalk.green("✓");
    const cross = chalk.red("✗");
    const lines: string[] = [""];
    lines.push(chalk.bold("  System Status:"));
    lines.push(chalk.dim("  ─────────────────────────────────────────"));
    lines.push(`  ${health.vmRunning ? check : cross} Virtual Machine`);
    lines.push(`  ${health.sshReady ? check : cross} SSH Connection`);
    lines.push(`  ${health.dockerReady ? check : cross} Docker Engine`);
    lines.push(`  ${health.serverHealthy ? check : cross} NEXUS Engine`);
    if (health.tunnelUrl) {
      lines.push(`  ${check} Tunnel: ${health.tunnelUrl}`);
    } else {
      lines.push(`  ${cross} Tunnel: not active`);
    }
    lines.push("");
    return lines.join("\n");
  } catch {
    return "  Could not check status";
  }
}

async function getCost(sshPort: number): Promise<string> {
  try {
    const { stdout, code } = await sshExec(sshPort, "curl -sf http://localhost:4200/cost");
    if (code !== 0) return "  Could not retrieve cost data";
    const data = JSON.parse(stdout);
    const lines: string[] = [""];
    lines.push(chalk.bold("  Token Costs:"));
    lines.push(chalk.dim("  ─────────────────────────────────────────"));
    if (data.total !== undefined) {
      lines.push(`  Total: ${chalk.bold.green("$" + Number(data.total).toFixed(4))}`);
    }
    if (data.today !== undefined) {
      lines.push(`  Today: ${chalk.bold("$" + Number(data.today).toFixed(4))}`);
    }
    if (data.by_agent && typeof data.by_agent === "object") {
      lines.push("");
      lines.push(chalk.dim("  By Agent:"));
      for (const [agent, cost] of Object.entries(data.by_agent)) {
        lines.push(`    ${agent.padEnd(20)} $${Number(cost).toFixed(4)}`);
      }
    }
    lines.push("");
    return lines.join("\n");
  } catch {
    return "  Could not retrieve cost data";
  }
}

export const shellCommand = new Command("shell")
  .description("Launch the interactive NEXUS shell")
  .action(async () => {
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

      // Health check
      const spinner = createSpinner("Connecting to NEXUS...");
      spinner.start();
      const health = await checkHealth(config.sshPort, true);
      if (!health.serverHealthy) {
        fail(spinner, "NEXUS engine is not responding");
        log.warn("Check status: buildwithnexus status");
        process.exit(1);
      }
      succeed(spinner, "Connected to NEXUS engine");

      // Show banner
      showShellBanner(health);

      // Event stream (background)
      const eventStream = new EventStream((event) => {
        const formatted = formatEvent(event);
        if (formatted) repl.write(formatted);
      });
      eventStream.start();

      // REPL
      const repl = new Repl(async (text: string) => {
        const thinkingSpinner = createSpinner("Processing...");
        thinkingSpinner.start();
        try {
          const response = await sendMessage(config.sshPort, text);
          thinkingSpinner.stop();
          thinkingSpinner.clear();
          console.log("");
          console.log(chalk.bold.cyan("  Chief of Staff:"));
          const lines = redact(response).split("\n");
          for (const line of lines) {
            console.log(chalk.white("  " + line));
          }
          console.log("");
        } catch (err) {
          thinkingSpinner.stop();
          thinkingSpinner.clear();
          throw err;
        }
      });

      // Register slash commands
      repl.registerCommand({
        name: "brainstorm",
        description: "Enter brainstorm mode",
        handler: async () => {
          console.log(chalk.dim("  Entering brainstorm mode... (type 'exit' to return)"));
          // Delegate to brainstorm conversation flow inline
          const { input } = await import("@inquirer/prompts");
          const idea = await input({ message: "What would you like to brainstorm?" });
          if (!idea.trim()) return;
          const brainstormSpinner = createSpinner("Chief of Staff is consulting the team...");
          brainstormSpinner.start();
          const response = await sendMessage(config.sshPort, `[BRAINSTORM] The CEO wants to brainstorm: ${idea}`);
          brainstormSpinner.stop();
          brainstormSpinner.clear();
          console.log("");
          console.log(chalk.bold.cyan("  Chief of Staff:"));
          for (const line of redact(response).split("\n")) {
            console.log(chalk.white("  " + line));
          }
          console.log("");
        },
      });

      repl.registerCommand({
        name: "status",
        description: "Show system health status",
        handler: async () => {
          const result = await getStatus(config.sshPort);
          console.log(result);
        },
      });

      repl.registerCommand({
        name: "agents",
        description: "List registered agents",
        handler: async () => {
          const result = await getAgentList(config.sshPort);
          console.log(result);
        },
      });

      repl.registerCommand({
        name: "cost",
        description: "Show token usage and costs",
        handler: async () => {
          const result = await getCost(config.sshPort);
          console.log(result);
        },
      });

      repl.registerCommand({
        name: "logs",
        description: "Show recent server logs",
        handler: async () => {
          const { stdout } = await sshExec(config.sshPort, "tail -30 /home/nexus/.nexus/logs/server.log 2>/dev/null");
          console.log("");
          console.log(chalk.bold("  Recent Logs:"));
          console.log(chalk.dim("  ─────────────────────────────────────────"));
          for (const line of redact(stdout).split("\n")) {
            console.log(chalk.dim("  " + line));
          }
          console.log("");
        },
      });

      repl.registerCommand({
        name: "ssh",
        description: "Open interactive SSH session",
        handler: async () => {
          const { openInteractiveSsh } = await import("../core/ssh.js");
          eventStream.stop();
          await openInteractiveSsh(config.sshPort);
          eventStream.start();
        },
      });

      // Clean exit
      process.on("SIGINT", () => {
        eventStream.stop();
        repl.stop();
      });

      await repl.start();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") {
        console.log("");
        log.success("Shell session ended");
        return;
      }
      const safeErr = redactError(err);
      log.error(`Shell failed: ${safeErr.message}`);
      process.exit(1);
    }
  });
