import { Command } from "commander";
import chalk from "chalk";
import { log } from "../ui/logger.js";
import { loadConfig } from "../core/secrets.js";
import { isVmRunning, getVmPid } from "../core/qemu.js";
import { checkHealth } from "../core/health.js";

export const statusCommand = new Command("status")
  .description("Check NEXUS runtime health")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const config = loadConfig();
    if (!config) {
      log.error("No NEXUS configuration found. Run: buildwithnexus init");
      process.exit(1);
    }

    const vmRunning = isVmRunning();
    const health = await checkHealth(config.sshPort, vmRunning);

    if (opts.json) {
      console.log(JSON.stringify({ ...health, pid: getVmPid(), ports: { ssh: config.sshPort, http: config.httpPort, https: config.httpsPort } }, null, 2));
      return;
    }

    const check = (ok: boolean) => ok ? chalk.green("●") : chalk.red("○");

    console.log("");
    console.log(chalk.bold("  NEXUS Runtime Status"));
    console.log("");
    console.log(`  ${check(health.vmRunning)}  VM         ${health.vmRunning ? chalk.green("running") + chalk.dim(` (PID ${getVmPid()})`) : chalk.red("stopped")}`);
    console.log(`  ${check(health.sshReady)}  SSH        ${health.sshReady ? chalk.green("connected") + chalk.dim(` (port ${config.sshPort})`) : chalk.red("unreachable")}`);
    console.log(`  ${check(health.dockerReady)}  Docker     ${health.dockerReady ? chalk.green("ready") : chalk.red("not ready")}`);
    console.log(`  ${check(health.serverHealthy)}  Server     ${health.serverHealthy ? chalk.green("healthy") + chalk.dim(` (port ${config.httpPort})`) : chalk.red("unhealthy")}`);
    console.log(`  ${check(!!health.tunnelUrl)}  Tunnel     ${health.tunnelUrl ? chalk.green(health.tunnelUrl) : chalk.dim("not active")}`);
    console.log("");

    if (health.serverHealthy) {
      log.success(`NEXUS CLI ready — connect via: buildwithnexus ssh`);
    }
  });
