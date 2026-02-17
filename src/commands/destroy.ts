import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import { input } from "@inquirer/prompts";
import { createSpinner, succeed } from "../ui/spinner.js";
import { log } from "../ui/logger.js";
import { NEXUS_HOME, loadConfig } from "../core/secrets.js";
import { isVmRunning, stopVm } from "../core/qemu.js";
import { stopTunnel } from "../core/tunnel.js";
import path from "node:path";

export const destroyCommand = new Command("destroy")
  .description("Remove NEXUS VM and all data")
  .option("--force", "Skip confirmation")
  .action(async (opts) => {
    const config = loadConfig();

    if (!opts.force) {
      console.log("");
      console.log(chalk.red.bold("  This will permanently delete:"));
      console.log(chalk.red("  - NEXUS VM and all data inside it"));
      console.log(chalk.red("  - VM disk images"));
      console.log(chalk.red("  - SSH keys"));
      console.log(chalk.red("  - Configuration and API keys"));
      console.log("");

      const confirm = await input({
        message: 'Type "destroy" to confirm:',
      });
      if (confirm !== "destroy") {
        log.warn("Aborted");
        return;
      }
    }

    const spinner = createSpinner("Destroying NEXUS runtime...");
    spinner.start();

    // Stop tunnel + VM
    if (config && isVmRunning()) {
      try { await stopTunnel(config.sshPort); } catch { /* */ }
      stopVm();
    }

    // Remove SSH config entry
    const sshConfigPath = path.join(process.env.HOME || "~", ".ssh", "config");
    if (fs.existsSync(sshConfigPath)) {
      const content = fs.readFileSync(sshConfigPath, "utf-8");
      const lines = content.split("\n");
      const filtered: string[] = [];
      let skip = false;
      for (const line of lines) {
        if (line.trim() === "Host nexus-vm") {
          skip = true;
          continue;
        }
        if (skip && line.startsWith("    ")) continue;
        skip = false;
        filtered.push(line);
      }
      fs.writeFileSync(sshConfigPath, filtered.join("\n"));
    }

    // Remove all buildwithnexus data
    fs.rmSync(NEXUS_HOME, { recursive: true, force: true });

    succeed(spinner, "NEXUS runtime destroyed");
    log.dim("Run 'buildwithnexus init' to set up again");
  });
