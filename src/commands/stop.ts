import { Command } from "commander";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { log } from "../ui/logger.js";
import { loadConfig } from "../core/secrets.js";
import { isVmRunning, stopVm } from "../core/qemu.js";
import { sshExec } from "../core/ssh.js";
import { stopTunnel } from "../core/tunnel.js";

export const stopCommand = new Command("stop")
  .description("Gracefully shut down the NEXUS runtime")
  .action(async () => {
    const config = loadConfig();
    if (!config) {
      log.error("No NEXUS configuration found. Run: buildwithnexus init");
      process.exit(1);
    }

    if (!isVmRunning()) {
      log.warn("VM is not running");
      return;
    }

    const spinner = createSpinner("Shutting down...");
    spinner.start();

    try {
      // Stop tunnel first
      if (config.enableTunnel) {
        spinner.text = "Stopping tunnel...";
        await stopTunnel(config.sshPort);
      }

      // Stop NEXUS server
      spinner.text = "Stopping NEXUS server...";
      await sshExec(config.sshPort, "sudo systemctl stop nexus");

      // Shutdown VM gracefully
      spinner.text = "Shutting down VM...";
      await sshExec(config.sshPort, "sudo shutdown -h now").catch(() => {});
      await new Promise((r) => setTimeout(r, 5000));

      // Force stop if still running
      if (isVmRunning()) {
        stopVm();
      }

      succeed(spinner, "NEXUS runtime stopped");
    } catch {
      // If SSH fails, force stop
      stopVm();
      succeed(spinner, "VM force-stopped");
    }
  });
