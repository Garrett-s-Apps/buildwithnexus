import { Command } from "commander";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { log } from "../ui/logger.js";
import { loadConfig } from "../core/secrets.js";
import { detectPlatform } from "../core/platform.js";
import { launchVm, isVmRunning } from "../core/qemu.js";
import { waitForSsh, sshExec } from "../core/ssh.js";
import { waitForServer } from "../core/health.js";
import { startTunnel } from "../core/tunnel.js";
import path from "node:path";
import { NEXUS_HOME } from "../core/secrets.js";

export const startCommand = new Command("start")
  .description("Start the NEXUS runtime")
  .action(async () => {
    const config = loadConfig();
    if (!config) {
      log.error("No NEXUS configuration found. Run: buildwithnexus init");
      process.exit(1);
    }

    if (isVmRunning()) {
      log.success("VM is already running");
      return;
    }

    const platform = detectPlatform();
    const diskPath = path.join(NEXUS_HOME, "vm", "images", "nexus-vm-disk.qcow2");
    const isoPath = path.join(NEXUS_HOME, "vm", "images", "init.iso");

    let spinner = createSpinner("Starting VM...");
    spinner.start();
    await launchVm(platform, diskPath, isoPath, config.vmRam, config.vmCpus, {
      ssh: config.sshPort,
      http: config.httpPort,
      https: config.httpsPort,
    });
    succeed(spinner, "VM started");

    spinner = createSpinner("Waiting for SSH...");
    spinner.start();
    const sshOk = await waitForSsh(config.sshPort, 120_000);
    if (!sshOk) {
      fail(spinner, "SSH timed out");
      process.exit(1);
    }
    succeed(spinner, "SSH connected");

    spinner = createSpinner("Starting NEXUS server...");
    spinner.start();
    await sshExec(config.sshPort, "sudo systemctl start nexus");
    const ok = await waitForServer(config.sshPort, 60_000);
    if (ok) {
      succeed(spinner, "NEXUS server running");
    } else {
      fail(spinner, "Server did not start — check: buildwithnexus logs");
    }

    if (config.enableTunnel) {
      spinner = createSpinner("Starting tunnel...");
      spinner.start();
      const url = await startTunnel(config.sshPort);
      if (url) {
        succeed(spinner, `Tunnel: ${url}`);
      } else {
        fail(spinner, "Tunnel failed");
      }
    }

    log.success(`Dashboard: http://localhost:${config.httpPort}/dashboard`);
  });
