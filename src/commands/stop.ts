import { Command } from "commander";
import { execa } from "execa";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { log } from "../ui/logger.js";

async function containerExists(): Promise<boolean> {
  try {
    const { stdout } = await execa("docker", [
      "ps", "-a", "--filter", "name=^nexus$", "--format", "{{.Names}}",
    ]);
    return stdout.trim() === "nexus";
  } catch {
    return false;
  }
}

async function isContainerRunning(): Promise<boolean> {
  try {
    const { stdout } = await execa("docker", [
      "ps", "--filter", "name=^nexus$", "--filter", "status=running",
      "--format", "{{.Names}}",
    ]);
    return stdout.trim() === "nexus";
  } catch {
    return false;
  }
}

export const stopCommand = new Command("stop")
  .description("Gracefully shut down the NEXUS runtime")
  .action(async () => {
    if (!(await containerExists())) {
      log.warn("NEXUS container does not exist");
      return;
    }

    const spinner = createSpinner("Shutting down NEXUS container...");
    spinner.start();

    try {
      if (await isContainerRunning()) {
        spinner.text = "Stopping container...";
        await execa("docker", ["stop", "nexus"]);
      }

      spinner.text = "Removing container...";
      await execa("docker", ["rm", "nexus"]);

      succeed(spinner, "NEXUS container stopped and removed");
    } catch (err) {
      fail(spinner, "Failed to stop NEXUS container");
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
