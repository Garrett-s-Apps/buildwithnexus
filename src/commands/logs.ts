import { Command } from "commander";
import { log } from "../ui/logger.js";
import { execa } from "execa";

export const logsCommand = new Command("logs")
  .description("View NEXUS server logs")
  .action(async () => {
    // Check if the nexus container exists
    let containerExists = false;
    try {
      const { stdout } = await execa("docker", [
        "ps", "-a", "--filter", "name=nexus", "--format", "{{.Names}}",
      ]);
      containerExists = stdout.trim().split("\n").some((name) => name === "nexus");
    } catch {
      log.error("Failed to query Docker. Is Docker running?");
      process.exit(1);
    }

    if (!containerExists) {
      log.error("NEXUS container not found. Start with: buildwithnexus start");
      process.exit(1);
    }

    const proc = execa("docker", ["logs", "-f", "nexus"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    await proc;
  });
