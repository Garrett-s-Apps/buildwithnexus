import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import { log } from "../ui/logger.js";
import { detectPlatform } from "../core/platform.js";
import { isDockerInstalled } from "../core/docker.js";
import { NEXUS_HOME, loadConfig } from "../core/secrets.js";
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

    console.log("");
    if (dockerOk) {
      log.success("Environment ready for NEXUS");
    } else {
      log.warn("Docker is required — install it from https://docs.docker.com/get-docker/");
    }
  });
