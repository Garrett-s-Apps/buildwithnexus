import { Command } from "commander";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { log } from "../ui/logger.js";
import { loadConfig } from "../core/secrets.js";
import { isVmRunning } from "../core/qemu.js";
import { sshExec } from "../core/ssh.js";

export const updateCommand = new Command("update")
  .description("Pull latest NEXUS code and restart")
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

    let spinner = createSpinner("Pulling latest code...");
    spinner.start();
    const pull = await sshExec(config.sshPort, "cd /home/nexus/nexus && git pull origin main");
    if (pull.code !== 0) {
      fail(spinner, `Git pull failed: ${pull.stderr}`);
      process.exit(1);
    }
    succeed(spinner, "Code updated");

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
    await sshExec(config.sshPort, "sudo systemctl restart nexus");
    await new Promise((r) => setTimeout(r, 3000));
    const health = await sshExec(config.sshPort, "curl -sf http://localhost:4200/health");
    if (health.code === 0) {
      succeed(spinner, "NEXUS server restarted and healthy");
    } else {
      fail(spinner, "Server restarted but health check failed — check: buildwithnexus logs");
    }
  });
