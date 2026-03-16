import { Command } from "commander";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { log } from "../ui/logger.js";
import { loadConfig } from "../core/secrets.js";
import { isNexusRunning, dockerExec } from "../core/docker.js";
import { execa } from "execa";

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

    if (!(await isNexusRunning())) {
      log.error("NEXUS is not running. Start with: buildwithnexus start");
      process.exit(1);
    }

    let spinner = createSpinner("Uploading release tarball...");
    spinner.start();
    const tarballPath = getReleaseTarball();
    await execa("docker", ["cp", tarballPath, "nexus:/tmp/nexus-release.tar.gz"]);
    succeed(spinner, "Tarball uploaded");

    spinner = createSpinner("Stopping NEXUS server...");
    spinner.start();
    await dockerExec("sudo systemctl stop nexus");
    succeed(spinner, "Server stopped");

    spinner = createSpinner("Extracting new release...");
    spinner.start();
    await dockerExec("rm -rf /home/nexus/nexus/src /home/nexus/nexus/docker");
    await dockerExec("tar xzf /tmp/nexus-release.tar.gz -C /home/nexus/nexus");
    await dockerExec("rm -f /tmp/nexus-release.tar.gz");
    succeed(spinner, "Release extracted");

    spinner = createSpinner("Installing dependencies...");
    spinner.start();
    await dockerExec("cd /home/nexus/nexus && .venv/bin/pip install -r requirements.txt -q");
    succeed(spinner, "Dependencies installed");

    spinner = createSpinner("Rebuilding Docker sandbox...");
    spinner.start();
    await dockerExec("docker build -t nexus-cli-sandbox /home/nexus/nexus/docker/cli-sandbox/");
    succeed(spinner, "Docker image rebuilt");

    spinner = createSpinner("Restarting NEXUS server...");
    spinner.start();
    await dockerExec("sudo systemctl start nexus");
    await new Promise((r) => setTimeout(r, 3000));
    const health = await dockerExec("curl -sf http://localhost:4200/health");
    if (health.code === 0) {
      succeed(spinner, "NEXUS server restarted and healthy");
    } else {
      fail(spinner, "Server restarted but health check failed — check: buildwithnexus logs");
    }
  });
