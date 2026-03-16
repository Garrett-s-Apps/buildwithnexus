import { Command } from "commander";
import chalk from "chalk";
import { Ora } from "ora";
import { showBanner, showPhase, showCompletion } from "../ui/banner.js";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { log } from "../ui/logger.js";
import { promptInitConfig } from "../ui/prompts.js";
import { detectPlatform } from "../core/platform.js";
import {
  ensureHome,
  generateMasterSecret,
  saveConfig,
  saveKeys,
  type NexusConfig,
  type NexusKeys,
} from "../core/secrets.js";
import {
  isDockerInstalled,
  imageExistsLocally,
  pullImage,
  startNexus,
  isNexusRunning,
  stopNexus,
} from "../core/docker.js";
import { installCloudflared, startTunnel } from "../core/tunnel.js";
import { redactError, validateAllKeys } from "../core/dlp.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run an async task wrapped in a spinner. Throws on failure. */
async function withSpinner<T>(
  spinner: Ora,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  spinner.text = label;
  spinner.start();
  const result = await fn();
  succeed(spinner, label);
  return result;
}

/**
 * Wait for the NEXUS server to respond on the given port.
 * Polls http://localhost:{port}/health with exponential backoff.
 * Timeout default: 120s (Docker starts much faster than a VM).
 */
async function waitForHealthy(port: number, timeoutMs = 120_000): Promise<boolean> {
  const start = Date.now();
  let attempt = 0;
  const backoffMs = (n: number) => Math.min(2000 * Math.pow(2, n), 10_000);

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) {
        const body = await res.text();
        if (body.includes("ok")) return true;
      }
    } catch {
      // not ready yet
    }

    const delay = backoffMs(attempt++);
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Context — shared mutable state passed through all phases
// ---------------------------------------------------------------------------

interface InitContext {
  config: NexusConfig;
  keys: NexusKeys;
  tunnelUrl: string | undefined;
  containerStarted: boolean;
}

// ---------------------------------------------------------------------------
// Phase interface
// ---------------------------------------------------------------------------

interface Phase {
  name: string;
  run: (ctx: Partial<InitContext>, spinner: Ora) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Phases (Docker-first flow)
// ---------------------------------------------------------------------------

const phases: Phase[] = [
  // Phase 1 — Configuration (~30s)
  {
    name: "Configuration",
    run: async (ctx) => {
      showBanner();
      const platform = detectPlatform();
      log.detail("Platform", `${platform.os} ${platform.arch}`);

      const userConfig = await promptInitConfig();
      ensureHome();

      const masterSecret = generateMasterSecret();
      const config: NexusConfig = {
        enableTunnel: userConfig.enableTunnel,
        httpPort: 4200,
        httpsPort: 8443,
        masterSecret,
      };

      const keys: NexusKeys = {
        ANTHROPIC_API_KEY: userConfig.anthropicKey,
        OPENAI_API_KEY: userConfig.openaiKey || undefined,
        GOOGLE_API_KEY: userConfig.googleKey || undefined,
        NEXUS_MASTER_SECRET: masterSecret,
      };

      const violations = validateAllKeys(keys as unknown as Record<string, string | undefined>);
      if (violations.length > 0) {
        for (const v of violations) log.error(v);
        process.exit(1);
      }

      saveConfig(config);
      saveKeys(keys);
      log.success("Configuration saved");

      ctx.config = config;
      ctx.keys = keys;
    },
  },

  // Phase 2 — Docker Check (install is handled by `buildwithnexus install`)
  {
    name: "Docker Check",
    run: async (_ctx, spinner) => {
      spinner.text = "Checking Docker...";
      spinner.start();

      const installed = await isDockerInstalled();
      if (installed) {
        succeed(spinner, "Docker is installed and running");
        return;
      }

      fail(spinner, "Docker is not installed or not running");
      throw new Error(
        "Docker is required but not available.\n\n" +
        "  Run the following command to install Docker:\n" +
        "    buildwithnexus install\n\n" +
        "  Then re-run:\n" +
        "    buildwithnexus init",
      );
    },
  },

  // Phase 3 — Pull Image (~1-2 min)
  {
    name: "Pull Image",
    run: async (_ctx, spinner) => {
      spinner.text = "Checking for buildwithnexus/nexus:latest...";
      spinner.start();

      const localExists = await imageExistsLocally("buildwithnexus/nexus", "latest");
      if (localExists) {
        succeed(spinner, "Image found locally: buildwithnexus/nexus:latest (skipping pull)");
        return;
      }

      spinner.stop(); // pullImage uses stdio: "inherit" for progress
      try {
        await pullImage("buildwithnexus/nexus", "latest");
        succeed(spinner, "Image pulled: buildwithnexus/nexus:latest");
      } catch (err) {
        fail(spinner, "Failed to pull buildwithnexus/nexus:latest");
        throw new Error(
          "Could not pull buildwithnexus/nexus:latest from registry.\n\n" +
          "  If you have built the image locally, you can build it with:\n" +
          "    docker build -f Dockerfile.nexus -t buildwithnexus/nexus:latest .\n\n" +
          "  Then re-run:\n" +
          "    buildwithnexus init",
        );
      }
    },
  },

  // Phase 4 — Launch Container (~10s)
  {
    name: "Launch",
    run: async (ctx, spinner) => {
      const { config, keys } = ctx as InitContext;

      // Stop any existing NEXUS container first
      const alreadyRunning = await isNexusRunning();
      if (alreadyRunning) {
        await withSpinner(spinner, "Stopping existing NEXUS container...", () => stopNexus());
      }

      await withSpinner(spinner, "Starting NEXUS container...", () =>
        startNexus(
          {
            anthropic: keys.ANTHROPIC_API_KEY,
            openai: keys.OPENAI_API_KEY || "",
          },
          { port: config.httpPort },
        ),
      );
      ctx.containerStarted = true;
    },
  },

  // Phase 5 — Health Check (~10s)
  {
    name: "Health Check",
    run: async (ctx, spinner) => {
      const { config } = ctx as InitContext;
      spinner.text = `Waiting for NEXUS server on port ${config.httpPort}...`;
      spinner.start();
      const healthy = await waitForHealthy(config.httpPort);
      if (!healthy) {
        fail(spinner, "Server failed to start within 120s");
        log.warn("Check logs: docker logs nexus");
        throw new Error("NEXUS server failed to respond to health checks");
      }
      succeed(spinner, `NEXUS server healthy on port ${config.httpPort}`);
    },
  },

  // Phase 6 — Cloudflare Tunnel (optional)
  {
    name: "Cloudflare Tunnel",
    run: async (ctx, spinner) => {
      const { config } = ctx as InitContext;
      if (!config.enableTunnel) {
        log.dim("Skipped (not enabled)");
        return;
      }

      const platform = detectPlatform();
      await withSpinner(spinner, "Installing cloudflared...", () =>
        installCloudflared(config.httpPort, platform.arch),
      );
      spinner.text = "Starting tunnel...";
      spinner.start();
      const url = await startTunnel(config.httpPort);
      if (url) {
        ctx.tunnelUrl = url;
        succeed(spinner, `Tunnel active: ${url}`);
      } else {
        fail(spinner, "Tunnel failed to start (server still accessible locally)");
      }
    },
  },

  // Phase 7 — Complete
  {
    name: "Complete",
    run: async (ctx) => {
      showCompletion({
        remote: ctx.tunnelUrl,
        ssh: `http://localhost:${ctx.config?.httpPort || 4200}`,
      });
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const TOTAL_PHASES = phases.length;

async function runInit(): Promise<void> {
  const ctx: Partial<InitContext> = { containerStarted: false, tunnelUrl: undefined };
  const spinner = createSpinner("");

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    showPhase(i + 1, TOTAL_PHASES, phase.name);

    try {
      await phase.run(ctx, spinner);
    } catch (err) {
      // Stop the spinner so the error message is clean
      try { spinner.stop(); } catch { /* ignore */ }

      // Clean up the container if it was started before the failure
      if (ctx.containerStarted) {
        process.stderr.write(chalk.dim("\n  Stopping container due to init failure...\n"));
        try { await stopNexus(); } catch { /* ignore */ }
      }

      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const initCommand = new Command("init")
  .description("Scaffold and launch a new NEXUS runtime (Docker)")
  .action(async () => {
    try {
      await runInit();
    } catch (err) {
      const safeErr = redactError(err);
      log.error(`Init failed: ${safeErr.message}`);
      process.exit(1);
    }
  });
