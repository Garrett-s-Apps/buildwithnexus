import { Command } from "commander";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { log } from "../ui/logger.js";
import { loadConfig } from "../core/secrets.js";
import { isVmRunning } from "../core/qemu.js";
import { sshExec, sshUploadFile } from "../core/ssh.js";

function getReleaseTarball(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const tarballPath = path.join(dir, "nexus-release.tar.gz");
  if (fs.existsSync(tarballPath)) return tarballPath;
  const rootPath = path.resolve(dir, "..", "dist", "nexus-release.tar.gz");
  if (fs.existsSync(rootPath)) return rootPath;
  throw new Error("nexus-release.tar.gz not found. Reinstall buildwithnexus to get the latest release.");
}

export const updateCommand = new Command("update")
  .description("Update NEXUS to the latest bundled release and restart")
  .action(async () => {
    const config = loadConfig();
    if (!config) {
      log.error("No NEXUS configuration found. Run: buildwithnexus init");
      process.exit(1);
    }

    if (!isVmRunning()) {
      log.error("VM is not running. Start with: buildwithnexus start");
      process.exit(1);
    }

    let spinner = createSpinner("Uploading release tarball...");
    spinner.start();
    const tarballPath = getReleaseTarball();
    await sshUploadFile(config.sshPort, tarballPath, "/tmp/nexus-release.tar.gz");
    succeed(spinner, "Tarball uploaded");

    spinner = createSpinner("Stopping NEXUS server...");
    spinner.start();
    await sshExec(config.sshPort, "sudo systemctl stop nexus");
    succeed(spinner, "Server stopped");

    spinner = createSpinner("Extracting new release...");
    spinner.start();
    await sshExec(config.sshPort, "rm -rf /home/nexus/nexus/src /home/nexus/nexus/docker");
    await sshExec(config.sshPort, "tar xzf /tmp/nexus-release.tar.gz -C /home/nexus/nexus");
    await sshExec(config.sshPort, "rm -f /tmp/nexus-release.tar.gz");
    succeed(spinner, "Release extracted");

    spinner = createSpinner("Installing dependencies...");
    spinner.start();
    await sshExec(config.sshPort, "cd /home/nexus/nexus && .venv/bin/pip install -r requirements.txt -q");
    succeed(spinner, "Dependencies installed");

    spinner = createSpinner("Rebuilding Docker sandbox...");
    spinner.start();
    await sshExec(config.sshPort, "docker build -t nexus-cli-sandbox /home/nexus/nexus/docker/cli-sandbox/");
    succeed(spinner, "Docker image rebuilt");

    spinner = createSpinner("Restarting NEXUS server...");
    spinner.start();
    await sshExec(config.sshPort, "sudo systemctl start nexus");
    await new Promise((r) => setTimeout(r, 3000));
    const health = await sshExec(config.sshPort, "curl -sf http://localhost:4200/health");
    if (health.code === 0) {
      succeed(spinner, "NEXUS server restarted and healthy");
    } else {
      fail(spinner, "Server restarted but health check failed — check: buildwithnexus logs");
    }
  });
