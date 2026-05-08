import { Command } from "commander";
import { log } from "../ui/logger.js";
import { execa } from "execa";
import { getBackendLogPath } from "../core/docker.js";
import fs from "node:fs";
import { spawn } from "node:child_process";

export const logsCommand = new Command("logs")
  .description("View NEXUS server logs")
  .option("-f, --follow", "Stream logs (follow mode)")
  .action(async (opts) => {
    const logPath = getBackendLogPath();
    const follow: boolean = opts.follow ?? false;

    // Prefer the local log file from the deep agents server
    if (fs.existsSync(logPath)) {
      if (follow) {
        const tail = spawn("tail", ["-f", logPath]);
        tail.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
        tail.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
        await new Promise((resolve) => tail.on("close", resolve));
      } else {
        const { stdout } = await execa("tail", ["-n", "200", logPath]);
        process.stdout.write(stdout);
      }
      return;
    }

    // Fall back to Docker container logs
    let containerExists = false;
    try {
      const { stdout } = await execa("docker", [
        "ps", "-a", "--filter", "name=nexus", "--format", "{{.Names}}",
      ]);
      containerExists = stdout.trim().split("\n").some((name) => name === "nexus");
    } catch {
      log.error("Backend log not found and Docker is not running.");
      log.warn(`Expected log at: ${logPath}`);
      log.warn("Start the backend with: buildwithnexus server");
      process.exit(1);
    }

    if (!containerExists) {
      log.error("No backend logs found.");
      log.warn(`Expected log at: ${logPath}`);
      log.warn("Start the backend with: buildwithnexus server");
      process.exit(1);
    }

    const args = follow ? ["logs", "-f", "nexus"] : ["logs", "--tail", "200", "nexus"];
    const proc = execa("docker", args, { stdout: "pipe", stderr: "pipe" });
    proc.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    await proc;
  });
