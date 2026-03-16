import { Command } from "commander";
import chalk from "chalk";
import { log } from "../ui/logger.js";
import { loadConfig } from "../core/secrets.js";
import { isNexusRunning } from "../core/docker.js";

interface HealthResponse {
  status?: string;
  version?: string;
  uptime?: number;
  [key: string]: unknown;
}

async function checkHttpHealth(port: number): Promise<{ healthy: boolean; version: string | null; uptimeSeconds: number | null }> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { healthy: false, version: null, uptimeSeconds: null };
    const text = await res.text();
    let version: string | null = null;
    let uptimeSeconds: number | null = null;
    try {
      const parsed = JSON.parse(text) as HealthResponse;
      if (typeof parsed.version === "string") version = parsed.version;
      if (typeof parsed.uptime === "number") uptimeSeconds = parsed.uptime;
    } catch { /* plain-text ok response */ }
    const healthy = text.includes("ok") || res.status === 200;
    return { healthy, version, uptimeSeconds };
  } catch {
    return { healthy: false, version: null, uptimeSeconds: null };
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export const statusCommand = new Command("status")
  .description("Check NEXUS runtime health")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const config = loadConfig();
    if (!config) {
      log.error("No NEXUS configuration found. Run: buildwithnexus init");
      process.exit(1);
    }

    const containerRunning = await isNexusRunning();
    const { healthy, version, uptimeSeconds } = containerRunning
      ? await checkHttpHealth(config.httpPort)
      : { healthy: false, version: null, uptimeSeconds: null };

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            containerRunning,
            healthy,
            version,
            uptimeSeconds,
            port: config.httpPort,
            lastChecked: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      return;
    }

    const check = (ok: boolean) => (ok ? chalk.green("●") : chalk.red("○"));

    console.log("");
    console.log(chalk.bold("  NEXUS Runtime Status"));
    console.log("");
    console.log(
      `  ${check(containerRunning)}  Container  ${
        containerRunning ? chalk.green("running") : chalk.red("stopped")
      }`,
    );
    console.log(
      `  ${check(healthy)}  Health     ${
        healthy
          ? chalk.green("healthy") +
            chalk.dim(` (port ${config.httpPort})`) +
            (version ? chalk.dim(` v${version}`) : "") +
            (uptimeSeconds !== null ? chalk.dim(` up ${formatUptime(uptimeSeconds)}`) : "")
          : chalk.red("unhealthy")
      }`,
    );
    console.log("");

    if (healthy) {
      log.success("NEXUS is running and healthy");
    } else if (containerRunning) {
      log.warn("Container is running but health check failed");
    } else {
      log.error("NEXUS container is not running. Start with: buildwithnexus start");
    }
  });
