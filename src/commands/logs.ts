import { Command } from "commander";
import { log } from "../ui/logger.js";
import { loadConfig } from "../core/secrets.js";
import { isVmRunning } from "../core/qemu.js";
import { sshExec } from "../core/ssh.js";
import { execa } from "execa";
import { redact, scrubEnv } from "../core/dlp.js";

export const logsCommand = new Command("logs")
  .description("View NEXUS server logs")
  .option("-f, --follow", "Follow log output")
  .option("-n, --lines <n>", "Number of lines to show", "50")
  .action(async (opts) => {
    const config = loadConfig();
    if (!config) {
      log.error("No NEXUS configuration found. Run: buildwithnexus init");
      process.exit(1);
    }

    if (!isVmRunning()) {
      log.error("VM is not running. Start with: buildwithnexus start");
      process.exit(1);
    }

    if (opts.follow) {
      // Stream tail -f through redaction filter
      const proc = execa("ssh", [
        "nexus-vm",
        "tail -f /home/nexus/.nexus/logs/server.log",
      ], { stdout: "pipe", stderr: "pipe", env: scrubEnv() });
      proc.stdout?.on("data", (chunk: Buffer) => process.stdout.write(redact(chunk.toString())));
      proc.stderr?.on("data", (chunk: Buffer) => process.stderr.write(redact(chunk.toString())));
      await proc;
    } else {
      const lines = /^\d+$/.test(opts.lines) ? parseInt(opts.lines, 10) : 50;
      if (lines < 1 || lines > 10000) {
        log.error("--lines must be between 1 and 10000");
        process.exit(1);
      }
      const { stdout } = await sshExec(
        config.sshPort,
        `tail -n ${lines} /home/nexus/.nexus/logs/server.log 2>/dev/null || echo "No logs yet"`,
      );
      console.log(redact(stdout));
    }
  });
