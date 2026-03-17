import { Command } from "commander";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { log } from "../ui/logger.js";
import { loadConfig, loadKeys } from "../core/secrets.js";
import { isNexusRunning, pullImage, launchNexus, imageExistsLocally } from "../core/docker.js";
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

    let spinner = createSpinner("Checking NEXUS image...");
    spinner.start();
    const localExists = await imageExistsLocally("buildwithnexus/nexus", "latest");
    if (!localExists) {
      spinner.text = "Pulling NEXUS image...";
      await pullImage("buildwithnexus/nexus", "latest");
    }
    succeed(spinner, "Image ready");

    const keys = loadKeys();
    if (!keys) {
      log.error("No API keys found. Run: buildwithnexus init");
      process.exit(1);
    }

    spinner = createSpinner("Starting NEXUS container...");
    spinner.start();
    const ok = await launchNexus(
      { anthropic: keys.ANTHROPIC_API_KEY, openai: keys.OPENAI_API_KEY || "" },
      { port: config.httpPort },
    );
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
