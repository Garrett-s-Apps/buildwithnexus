import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import { log } from "../ui/logger.js";
import { detectPlatform } from "../core/platform.js";
import { isDockerInstalled } from "../core/docker.js";
import { NEXUS_HOME, loadConfig, getBackendUrl } from "../core/secrets.js";
import path from "node:path";
import { execa } from "execa";

export const doctorCommand = new Command("doctor")
  .description("Diagnose NEXUS runtime environment")
  .action(async () => {
    const platform = detectPlatform();
    const check = (ok: boolean) => ok ? chalk.green("✓") : chalk.red("✗");

    console.log("");
    console.log(chalk.bold("  NEXUS Doctor"));
    console.log("");

    // Node version
    const nodeOk = Number(process.versions.node.split(".")[0]) >= 18;
    console.log(`  ${check(nodeOk)}  Node.js ${process.versions.node} ${nodeOk ? "" : chalk.red("(need >= 18)")}`);

    // Platform
    console.log(`  ${check(true)}  Platform: ${platform.os} ${platform.arch}`);

    // Docker
    const dockerOk = await isDockerInstalled();
    if (dockerOk) {
      console.log(`  ${check(true)}  Docker installed and running`);
    } else {
      console.log(`  ${check(false)}  Docker not installed`);
    }

    // SSH key
    const keyExists = fs.existsSync(path.join(NEXUS_HOME, "ssh", "id_nexus_vm"));
    console.log(`  ${check(keyExists)}  SSH key`);

    // Config
    const config = loadConfig();
    console.log(`  ${check(!!config)}  Configuration`);

    // Port availability
    if (config) {
      for (const [name, port] of [["HTTP", config.httpPort], ["HTTPS", config.httpsPort]] as const) {
        try {
          const net = await import("node:net");
          const available = await new Promise<boolean>((resolve) => {
            const server = net.createServer();
            server.once("error", () => resolve(false));
            server.once("listening", () => { server.close(); resolve(true); });
            server.listen(port);
          });
          console.log(`  ${check(available)}  Port ${port} (${name}) ${available ? "available" : chalk.red("in use")}`);
        } catch {
          console.log(`  ${check(false)}  Port ${port} (${name}) — check failed`);
        }
      }
    }

    // Deep agents backend (primary server)
    const backendUrl = getBackendUrl();
    try {
      const res = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(3000) });
      const backendOk = res.ok;
      console.log(`  ${check(backendOk)}  NEXUS backend at ${backendUrl} ${backendOk ? "" : chalk.yellow("(not running — start with: buildwithnexus server)")}`);
    } catch {
      console.log(`  ${check(false)}  NEXUS backend at ${backendUrl} ${chalk.yellow("(not running — start with: buildwithnexus server)")}`);
    }

    // Python / uv
    try {
      const { stdout: pyVersion } = await execa("python3", ["--version"]);
      const pyOk = !!pyVersion;
      console.log(`  ${check(pyOk)}  ${pyVersion}`);
    } catch {
      console.log(`  ${check(false)}  python3 not found (required for NEXUS backend)`);
    }

    console.log("");
    log.success("Diagnostics complete");
  });
