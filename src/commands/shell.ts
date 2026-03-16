import { Command } from "commander";
import chalk from "chalk";
import { log } from "../ui/logger.js";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { loadConfig } from "../core/secrets.js";
import { isNexusRunning } from "../core/docker.js";
import { redact, redactError, shellEscape } from "../core/dlp.js";
import { Repl } from "../ui/repl.js";
import { EventStream, formatEvent } from "../core/event-stream.js";

async function httpPost(httpPort: number, path: string, body: unknown): Promise<string> {
  const res = await fetch(`http://localhost:${httpPort}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return parsed.response ?? parsed.message ?? text;
  } catch {
    return text;
  }
}

async function httpGet(httpPort: number, path: string): Promise<{ ok: boolean; text: string }> {
  try {
    const res = await fetch(`http://localhost:${httpPort}${path}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    return { ok: res.ok, text };
  } catch {
    return { ok: false, text: "" };
  }
}

async function sendMessage(httpPort: number, message: string): Promise<string> {
  return httpPost(httpPort, "/message", { message, source: "shell" });
}

function showShellBanner(health: { containerRunning: boolean; serverHealthy: boolean; tunnelUrl: string | null }): void {
  const check = chalk.green("✓");
  const cross = chalk.red("✗");

  console.log("");
  console.log(chalk.bold("  ╔══════════════════════════════════════════════════════════╗"));
  console.log(chalk.bold("  ║  ") + chalk.bold.cyan("NEXUS Interactive Shell") + chalk.bold("                                 ║"));
  console.log(chalk.bold("  ╠══════════════════════════════════════════════════════════╣"));
  console.log(chalk.bold("  ║  ") + `${health.containerRunning ? check : cross} Container    ${health.serverHealthy ? check : cross} Engine`.padEnd(55) + chalk.bold("║"));
  if (health.tunnelUrl) {
    console.log(chalk.bold("  ║  ") + chalk.dim(`Tunnel: ${health.tunnelUrl}`.padEnd(55)) + chalk.bold("║"));
  }
  console.log(chalk.bold("  ╠══════════════════════════════════════════════════════════╣"));
  console.log(chalk.bold("  ║  ") + chalk.dim("Type naturally to chat · /help for commands".padEnd(55)) + chalk.bold("║"));
  console.log(chalk.bold("  ╚══════════════════════════════════════════════════════════╝"));
  console.log("");
}

async function getAgentList(httpPort: number): Promise<string> {
  try {
    const { ok, text } = await httpGet(httpPort, "/agents");
    if (!ok) return "  Could not retrieve agent list";
    const agents = JSON.parse(text);
    if (!Array.isArray(agents)) return text;
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

async function getStatus(httpPort: number): Promise<string> {
  try {
    const containerRunning = await isNexusRunning();
    let serverHealthy = false;
    let tunnelUrl: string | null = null;
    if (containerRunning) {
      const { ok, text } = await httpGet(httpPort, "/health");
      serverHealthy = ok && (text.includes("ok") || true);
      const tunnelRes = await httpGet(httpPort, "/tunnel-url");
      if (tunnelRes.ok && tunnelRes.text.includes("https://")) {
        tunnelUrl = tunnelRes.text.trim();
      }
    }
    const check = chalk.green("✓");
    const cross = chalk.red("✗");
    const lines: string[] = [""];
    lines.push(chalk.bold("  System Status:"));
    lines.push(chalk.dim("  ─────────────────────────────────────────"));
    lines.push(`  ${containerRunning ? check : cross} NEXUS Container`);
    lines.push(`  ${serverHealthy ? check : cross} NEXUS Engine`);
    if (tunnelUrl) {
      lines.push(`  ${check} Tunnel: ${tunnelUrl}`);
    } else {
      lines.push(`  ${cross} Tunnel: not active`);
    }
    lines.push("");
    return lines.join("\n");
  } catch {
    return "  Could not check status";
  }
}

async function getCost(httpPort: number): Promise<string> {
  try {
    const { ok, text } = await httpGet(httpPort, "/cost");
    if (!ok) return "  Could not retrieve cost data";
    const data = JSON.parse(text);
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

      if (!(await isNexusRunning())) {
        log.error("NEXUS is not running. Start it with: buildwithnexus start");
        process.exit(1);
      }

      // Health check
      const spinner = createSpinner("Connecting to NEXUS...");
      spinner.start();
      const { ok: serverHealthy, text: healthText } = await httpGet(config.httpPort, "/health");
      if (!serverHealthy) {
        fail(spinner, "NEXUS engine is not responding");
        log.warn("Check status: buildwithnexus status");
        process.exit(1);
      }
      succeed(spinner, "Connected to NEXUS engine");

      // Resolve tunnel URL if available
      let tunnelUrl: string | null = null;
      const tunnelRes = await httpGet(config.httpPort, "/tunnel-url");
      if (tunnelRes.ok && tunnelRes.text.includes("https://")) {
        tunnelUrl = tunnelRes.text.trim();
      }

      // Show banner
      showShellBanner({ containerRunning: true, serverHealthy: true, tunnelUrl });

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
          const response = await sendMessage(config.httpPort, text);
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
        description: "Brainstorm with the full NEXUS org (led by Chief of Staff)",
        handler: async () => {
          console.log("");
          console.log(chalk.bold("  ╔══════════════════════════════════════════════════════════╗"));
          console.log(chalk.bold("  ║  ") + chalk.bold.cyan("NEXUS Brainstorm Session") + chalk.bold("                                ║"));
          console.log(chalk.bold("  ╠══════════════════════════════════════════════════════════╣"));
          console.log(chalk.bold("  ║  ") + chalk.dim("The Chief of Staff will facilitate a discussion with".padEnd(55)) + chalk.bold("║"));
          console.log(chalk.bold("  ║  ") + chalk.dim("the full NEXUS org to refine your idea. When ready,".padEnd(55)) + chalk.bold("║"));
          console.log(chalk.bold("  ║  ") + chalk.dim("NEXUS will draft an execution plan for your review.".padEnd(55)) + chalk.bold("║"));
          console.log(chalk.bold("  ║  ") + chalk.dim("Type 'exit' to end brainstorm. Type 'plan' to hand off.".padEnd(55)) + chalk.bold("║"));
          console.log(chalk.bold("  ╚══════════════════════════════════════════════════════════╝"));
          console.log("");

          const { input } = await import("@inquirer/prompts");
          const idea = await input({ message: "What would you like to brainstorm?" });
          if (!idea.trim()) return;

          let currentMessage = `[BRAINSTORM] The CEO wants to brainstorm the following idea. As Chief of Staff, facilitate a discussion with the entire NEXUS organization — involve VPs, engineers, QA, security, and any relevant specialists. Gather diverse perspectives, identify risks and opportunities, and help refine the idea. Do NOT execute — only discuss, analyze, and recommend. Idea: ${idea}`;

          while (true) {
            const brainstormSpinner = createSpinner("NEXUS team is discussing...");
            brainstormSpinner.start();
            const response = await sendMessage(config.httpPort, currentMessage);
            brainstormSpinner.stop();
            brainstormSpinner.clear();
            console.log("");
            console.log(chalk.bold.cyan("  Chief of Staff:"));
            for (const line of redact(response).split("\n")) {
              console.log(chalk.white("  " + line));
            }
            console.log("");

            const followUp = await input({ message: chalk.bold("You:") });
            const trimmed = followUp.trim().toLowerCase();
            if (!trimmed || trimmed === "exit" || trimmed === "quit") {
              console.log("");
              log.success("Brainstorm session ended");
              return;
            }
            if (trimmed === "plan" || trimmed === "execute" || trimmed === "go") {
              const planSpinner = createSpinner("Handing off to NEXUS for execution planning...");
              planSpinner.start();
              const planResponse = await sendMessage(config.httpPort, `[BRAINSTORM→PLAN] The CEO approves this direction from the brainstorm session. Draft a detailed execution plan with task assignments, timelines, and dependencies. Previous discussion context: ${idea}`);
              planSpinner.stop();
              planSpinner.clear();
              console.log("");
              console.log(chalk.bold.green("  Execution Plan:"));
              for (const line of redact(planResponse).split("\n")) {
                console.log(chalk.white("  " + line));
              }
              console.log("");
              log.success("Plan drafted. Use the shell to refine or approve.");
              return;
            }
            currentMessage = `[BRAINSTORM FOLLOW-UP] The CEO responds: ${followUp}`;
          }
        },
      });

      repl.registerCommand({
        name: "status",
        description: "Show system health status",
        handler: async () => {
          const result = await getStatus(config.httpPort);
          console.log(result);
        },
      });

      repl.registerCommand({
        name: "agents",
        description: "List registered agents",
        handler: async () => {
          const result = await getAgentList(config.httpPort);
          console.log(result);
        },
      });

      repl.registerCommand({
        name: "cost",
        description: "Show token usage and costs",
        handler: async () => {
          const result = await getCost(config.httpPort);
          console.log(result);
        },
      });

      repl.registerCommand({
        name: "logs",
        description: "Show recent container logs",
        handler: async () => {
          const { execa } = await import("execa");
          console.log("");
          console.log(chalk.bold("  Recent Logs:"));
          console.log(chalk.dim("  ─────────────────────────────────────────"));
          try {
            const { stdout } = await execa("docker", ["logs", "--tail", "30", "nexus"]);
            for (const line of redact(stdout).split("\n")) {
              console.log(chalk.dim("  " + line));
            }
          } catch {
            console.log(chalk.dim("  Could not retrieve logs"));
          }
          console.log("");
        },
      });

      repl.registerCommand({
        name: "exec",
        description: "Drop into the container shell for debugging/inspection",
        handler: async () => {
          const { execa } = await import("execa");
          eventStream.stop();
          try {
            await execa("docker", ["exec", "-it", "nexus", "/bin/sh"], { stdio: "inherit" });
          } catch { /* user exited */ }
          eventStream.start();
        },
      });

      repl.registerCommand({
        name: "org-chart",
        description: "Display the NEXUS organizational hierarchy",
        handler: async () => {
          console.log("");
          console.log(chalk.bold("  NEXUS Organizational Hierarchy"));
          console.log(chalk.dim("  ─────────────────────────────────────────────────"));
          console.log(`  ${chalk.bold.white("You")} ${chalk.dim("(CEO)")}`);
          console.log(`  └── ${chalk.bold.cyan("Chief of Staff")} ${chalk.dim("— orchestrates all work, your direct interface")}`);
          console.log(`      ├── ${chalk.bold.blue("VP Engineering")} ${chalk.dim("— owns technical execution")}`);
          console.log(`      │   ├── ${chalk.green("Senior Engineer")} ${chalk.dim("× 8 — implementation, refactoring")}`);
          console.log(`      │   ├── ${chalk.green("Engineer")} ${chalk.dim("× 12 — feature work, bug fixes")}`);
          console.log(`      │   └── ${chalk.hex("#FF8C00")("DevOps Engineer")} ${chalk.dim("× 4 — CI/CD, Docker, infra")}`);
          console.log(`      ├── ${chalk.bold.magenta("VP Product")} ${chalk.dim("— owns roadmap and priorities")}`);
          console.log(`      │   ├── ${chalk.magenta("Product Manager")} ${chalk.dim("× 3 — specs, requirements")}`);
          console.log(`      │   └── ${chalk.magenta("Designer")} ${chalk.dim("× 2 — UI/UX, prototyping")}`);
          console.log(`      ├── ${chalk.bold.yellow("QA Lead")} ${chalk.dim("— owns quality assurance")}`);
          console.log(`      │   └── ${chalk.yellow("QA Engineer")} ${chalk.dim("× 6 — testing, coverage, validation")}`);
          console.log(`      ├── ${chalk.bold.red("Security Engineer")} ${chalk.dim("× 4 — auth, scanning, compliance")}`);
          console.log(`      └── ${chalk.bold.white("Knowledge Manager")} ${chalk.dim("— RAG, documentation, learning")}`);
          console.log("");
          console.log(chalk.dim("  56 agents total · Self-learning ML pipeline"));
          console.log(chalk.dim("  Full details: https://buildwithnexus.dev/overview"));
          console.log("");
        },
      });

      repl.registerCommand({
        name: "security",
        description: "Show the security posture of this runtime",
        handler: async () => {
          const { showSecurityPosture } = await import("../ui/banner.js");
          showSecurityPosture();
        },
      });

      repl.registerCommand({
        name: "tutorial",
        description: "Guided walkthrough of NEXUS capabilities",
        handler: async () => {
          const { input } = await import("@inquirer/prompts");
          const steps = [
            {
              title: "Welcome to NEXUS",
              content: [
                "NEXUS is a 56-agent autonomous engineering organization.",
                "You are the CEO. The Chief of Staff leads your team.",
                "",
                "When you type a request, the Chief of Staff:",
                "  1. Analyzes what needs to be done",
                "  2. Delegates to the right VPs and specialists",
                "  3. Agents collaborate, review each other's work",
                "  4. Results stream back to you in real time",
              ],
            },
            {
              title: "The Org Chart",
              content: [
                "You → Chief of Staff → VPs → Engineers",
                "",
                "  VP Engineering  — 24 engineers, DevOps",
                "  VP Product      — PMs, designers",
                "  QA Lead         — 6 QA engineers",
                "  Security        — 4 security engineers",
                "  Knowledge       — RAG, documentation",
                "",
                "Run /org-chart to see the full hierarchy.",
              ],
            },
            {
              title: "Try It: Natural Language",
              content: [
                "Just type what you want built. Examples:",
                "",
                '  "Build a REST API with JWT authentication"',
                '  "Fix the memory leak in the worker pool"',
                '  "Refactor the database layer to use connection pooling"',
                "",
                "NEXUS assigns the right agents automatically.",
                "You'll see their thinking and delegation in real time.",
              ],
            },
            {
              title: "Brainstorming",
              content: [
                "Use /brainstorm to explore ideas before committing.",
                "",
                "The Chief of Staff facilitates an org-wide discussion:",
                "  - Engineers assess technical feasibility",
                "  - Security flags risks",
                "  - Product suggests user impact",
                "  - QA identifies testing needs",
                "",
                "Type 'plan' when ready to hand off for execution.",
              ],
            },
            {
              title: "Monitoring & Control",
              content: [
                "  /status   — System health (Container, Engine)",
                "  /agents   — List all 56 registered agents",
                "  /cost     — Token usage and spend tracking",
                "  /logs     — Container logs for debugging",
                "  /exec     — Drop into the container shell",
                "  /security — View the security posture",
                "",
                "You're in control. NEXUS executes.",
              ],
            },
          ];

          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            console.log("");
            console.log(chalk.bold(`  ── ${chalk.cyan(`Step ${i + 1}/${steps.length}`)} ── ${step.title} ──`));
            console.log("");
            for (const line of step.content) {
              console.log(chalk.white("  " + line));
            }
            console.log("");
            if (i < steps.length - 1) {
              const next = await input({ message: chalk.dim("Press Enter to continue (or 'skip' to exit)") });
              if (next.trim().toLowerCase() === "skip") {
                log.success("Tutorial ended. Type /help to see all commands.");
                return;
              }
            }
          }
          console.log("");
          log.success("Tutorial complete! Start typing to talk to NEXUS.");
          console.log("");
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
