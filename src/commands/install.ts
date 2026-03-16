import { Command } from "commander";
import { execa } from "execa";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { log } from "../ui/logger.js";
import { detectPlatform } from "../core/platform.js";
import { isDockerInstalled, installDocker } from "../core/docker.js";

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const installCommand = new Command("install")
  .description("Install Docker and configure system prerequisites")
  .action(async () => {
    const spinner = createSpinner("");

    log.step("Checking Docker installation...");

    // 1. Check if Docker is already installed and running
    const alreadyInstalled = await isDockerInstalled();
    if (alreadyInstalled) {
      try {
        const { stdout } = await execa("docker", ["--version"]);
        log.success(`Docker is already installed and running: ${stdout.trim()}`);
      } catch {
        log.success("Docker is already installed and running.");
      }
      return;
    }

    // 2. Install Docker for the current platform
    const platform = detectPlatform();
    log.step(`Installing Docker for ${platform.os} (${platform.arch})...`);

    try {
      await installDocker(platform);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Docker installation failed: ${msg}`);
      process.exit(1);
    }

    // 3. Verify installation
    spinner.text = "Verifying Docker installation...";
    spinner.start();

    const verified = await isDockerInstalled();
    if (!verified) {
      fail(spinner, "Docker installation could not be verified");
      log.error(
        "Docker was installed but is not responding.\n\n" +
        "  Please ensure Docker is running, then verify with:\n" +
        "    docker --version\n\n" +
        "  Once Docker is running, you can proceed with:\n" +
        "    buildwithnexus init",
      );
      process.exit(1);
    }

    try {
      const { stdout } = await execa("docker", ["--version"]);
      succeed(spinner, `Docker verified: ${stdout.trim()}`);
    } catch {
      succeed(spinner, "Docker is installed and running");
    }

    log.success("\nDocker setup complete! You can now run:\n\n  buildwithnexus init\n");
  });
