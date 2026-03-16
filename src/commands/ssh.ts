import { Command } from "commander";
import { execa } from "execa";
import { log } from "../ui/logger.js";
import { isNexusRunning } from "../core/docker.js";

export const sshCommand = new Command("ssh")
  .description("Open an interactive shell inside the NEXUS container")
  .action(async () => {
    const running = await isNexusRunning();
    if (!running) {
      log.error("NEXUS container is not running. Start it with: buildwithnexus start");
      process.exit(1);
    }

    log.dim("Opening shell in NEXUS container...");
    await execa("docker", ["exec", "-it", "nexus", "/bin/bash"], { stdio: "inherit" });
  });
