import { Command } from "commander";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { log } from "../ui/logger.js";
import { loadConfig, loadKeys } from "../core/secrets.js";
import { isNexusRunning, startNexus, pullImage } from "../core/docker.js";
import { waitForServer } from "../core/health.js";
import { startTunnel } from "../core/tunnel.js";

export const startCommand = new Command("start")
  .description("Start the NEXUS runtime")
  .action(async () => {
    const config = loadConfig();
    if (!config) {
      log.error("No NEXUS configuration found. Run: buildwithnexus init");
      process.exit(1);
    }

    if (await isNexusRunning()) {
      log.success("NEXUS is already running");
      return;
    }

    let spinner = createSpinner("Pulling NEXUS image...");
    spinner.start();
    await pullImage("buildwithnexus/nexus", "latest");
    succeed(spinner, "Image ready");

    spinner = createSpinner("Starting NEXUS container...");
    spinner.start();
    const keys = loadKeys();
    if (!keys) {
      fail(spinner, "No API keys found. Run: buildwithnexus init");
      process.exit(1);
    }
    await startNexus(
      { anthropic: keys.ANTHROPIC_API_KEY, openai: keys.OPENAI_API_KEY || "" },
      { port: config.httpPort }
    );
    succeed(spinner, "Container started");

    spinner = createSpinner("Waiting for NEXUS server...");
    spinner.start();
    const ok = await waitForServer(60_000);
    if (ok) {
      succeed(spinner, "NEXUS server running");
    } else {
      fail(spinner, "Server did not start — check: buildwithnexus logs");
    }

    if (config.enableTunnel) {
      spinner = createSpinner("Starting tunnel...");
      spinner.start();
      const url = await startTunnel();
      if (url) {
        succeed(spinner, `Tunnel: ${url}`);
      } else {
        fail(spinner, "Tunnel failed");
      }
    }

    log.success("NEXUS runtime ready — connect via: buildwithnexus ssh");
  });
