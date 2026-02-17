import { Command } from "commander";
import { log } from "../ui/logger.js";
import { loadConfig } from "../core/secrets.js";
import { isVmRunning } from "../core/qemu.js";
import { openInteractiveSsh } from "../core/ssh.js";

export const sshCommand = new Command("ssh")
  .description("Open an SSH session into the NEXUS VM")
  .action(async () => {
    const config = loadConfig();
    if (!config) {
      log.error("No NEXUS configuration found. Run: buildwithnexus init");
      process.exit(1);
    }

    if (!isVmRunning()) {
      log.error("VM is not running. Start it with: buildwithnexus start");
      process.exit(1);
    }

    log.dim(`Connecting to nexus-vm (port ${config.sshPort})...`);
    await openInteractiveSsh(config.sshPort);
  });
