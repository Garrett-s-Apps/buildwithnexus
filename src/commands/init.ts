import { Command } from "commander";
import chalk from "chalk";
import { Ora } from "ora";
import { showBanner, showPhase, showCompletion } from "../ui/banner.js";
import { createSpinner, succeed, fail } from "../ui/spinner.js";
import { log } from "../ui/logger.js";
import { promptInitConfig } from "../ui/prompts.js";
import { detectPlatform, type PlatformInfo } from "../core/platform.js";
import {
  ensureHome,
  generateMasterSecret,
  saveConfig,
  saveKeys,
  type NexusConfig,
  type NexusKeys,
} from "../core/secrets.js";
import {
  isQemuInstalled,
  installQemu,
  downloadImage,
  createDisk,
  launchVm,
  resolvePortConflicts,
  stopVm,
  type ResolvedPorts,
} from "../core/qemu.js";
import { generateSshKey, addSshConfig, waitForSsh, getPubKey, sshUploadFile } from "../core/ssh.js";
import { renderCloudInit, createCloudInitIso } from "../core/cloudinit.js";
import { waitForCloudInit, waitForServer } from "../core/health.js";
import { installCloudflared, startTunnel } from "../core/tunnel.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { redactError, validateAllKeys, DlpViolation } from "../core/dlp.js";
import { sshExec } from "../core/ssh.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getReleaseTarball(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const tarballPath = path.join(dir, "nexus-release.tar.gz");
  if (fs.existsSync(tarballPath)) return tarballPath;
  const rootPath = path.resolve(dir, "..", "dist", "nexus-release.tar.gz");
  if (fs.existsSync(rootPath)) return rootPath;
  throw new Error("nexus-release.tar.gz not found. Run: npm run bundle");
}

function getCloudInitTemplate(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.join(dir, "templates", "cloud-init.yaml.ejs");
  if (fs.existsSync(templatePath)) return fs.readFileSync(templatePath, "utf-8");
  const srcPath = path.resolve(dir, "..", "src", "templates", "cloud-init.yaml.ejs");
  return fs.readFileSync(srcPath, "utf-8");
}

// Run an async task wrapped in a spinner. Throws on failure (caller handles cleanup).
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

// ---------------------------------------------------------------------------
// Context — shared mutable state passed through all phases
// ---------------------------------------------------------------------------

interface InitContext {
  platform: PlatformInfo;
  config: NexusConfig;
  keys: NexusKeys;
  tarballPath: string;
  imagePath: string;
  diskPath: string;
  isoPath: string;
  resolvedPorts: ResolvedPorts;
  tunnelUrl: string | undefined;
  vmLaunched: boolean; // so cleanup knows whether to stopVm
}

// ---------------------------------------------------------------------------
// Phase interface
// ---------------------------------------------------------------------------

interface Phase {
  name: string;
  skip?: (ctx: Partial<InitContext>) => boolean;
  run: (ctx: Partial<InitContext>, spinner: Ora) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

const phases: Phase[] = [
  // Phase 1 — Configuration
  {
    name: "Configuration",
    run: async (ctx) => {
      showBanner();
      const platform = detectPlatform();
      log.detail("Platform", `${platform.os} ${platform.arch}`);
      log.detail("QEMU", platform.qemuBinary);

      const userConfig = await promptInitConfig();
      ensureHome();

      const masterSecret = generateMasterSecret();
      const config: NexusConfig = {
        vmRam: userConfig.vmRam,
        vmCpus: userConfig.vmCpus,
        vmDisk: userConfig.vmDisk,
        enableTunnel: userConfig.enableTunnel,
        sshPort: 2222,
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

      ctx.platform = platform;
      ctx.config = config;
      ctx.keys = keys;
    },
  },

  // Phase 2 — QEMU
  {
    name: "QEMU Installation",
    run: async (ctx, spinner) => {
      const { platform } = ctx as InitContext;
      await withSpinner(spinner, "Checking QEMU...", async () => {
        const hasQemu = await isQemuInstalled(platform);
        if (!hasQemu) {
          spinner.text = "Installing QEMU...";
          await installQemu(platform);
        }
      });
      succeed(spinner, hasQemuLabel(await isQemuInstalled(ctx.platform!)));
    },
  },

  // Phase 3 — SSH Keys
  {
    name: "SSH Key Setup",
    run: async (ctx, spinner) => {
      const { config } = ctx as InitContext;
      await withSpinner(spinner, "Generating SSH key...", async () => {
        await generateSshKey();
        addSshConfig(config.sshPort);
      });
    },
  },

  // Phase 4 — Ubuntu Image
  {
    name: "VM Image Download",
    run: async (ctx, spinner) => {
      const { platform } = ctx as InitContext;
      const imagePath = await withSpinner(
        spinner,
        `Downloading Ubuntu 24.04 (${platform.ubuntuImage})...`,
        () => downloadImage(platform),
      );
      ctx.imagePath = imagePath;
    },
  },

  // Phase 5 — Cloud-Init
  {
    name: "Cloud-Init Generation",
    run: async (ctx, spinner) => {
      const { keys, config } = ctx as InitContext;

      const tarballPath = await withSpinner(spinner, "Locating release tarball...", async () => {
        return getReleaseTarball();
      });
      ctx.tarballPath = tarballPath;

      const isoPath = await withSpinner(spinner, "Rendering cloud-init...", async () => {
        const pubKey = getPubKey();
        const template = getCloudInitTemplate();
        const userDataPath = await renderCloudInit({ sshPubKey: pubKey, keys, config }, template);
        return createCloudInitIso(userDataPath);
      });
      ctx.isoPath = isoPath;
    },
  },

  // Phase 6 — VM Boot
  {
    name: "VM Launch",
    run: async (ctx, spinner) => {
      const { platform, imagePath, isoPath, config } = ctx as InitContext;

      // Port conflict resolution needs interactive input — pause spinner
      spinner.text = "Checking port availability...";
      spinner.start();
      spinner.stop();
      spinner.clear();
      const requestedPorts = { ssh: config.sshPort, http: config.httpPort, https: config.httpsPort };
      const resolvedPorts = await resolvePortConflicts(requestedPorts);

      const diskPath = await withSpinner(spinner, "Creating disk and launching VM...", async () => {
        const disk = await createDisk(imagePath, config.vmDisk);
        await launchVm(platform, disk, isoPath, config.vmRam, config.vmCpus, resolvedPorts);
        return disk;
      });

      // Update config with actual ports (may differ after conflict resolution)
      config.sshPort = resolvedPorts.ssh;
      config.httpPort = resolvedPorts.http;
      config.httpsPort = resolvedPorts.https;
      saveConfig(config);

      const portNote = (resolvedPorts.ssh !== 2222 || resolvedPorts.http !== 4200 || resolvedPorts.https !== 8443)
        ? ` (ports: SSH=${resolvedPorts.ssh}, HTTP=${resolvedPorts.http}, HTTPS=${resolvedPorts.https})`
        : "";
      succeed(spinner, `VM launched (daemonized)${portNote}`);

      ctx.diskPath = diskPath;
      ctx.resolvedPorts = resolvedPorts;
      ctx.vmLaunched = true;
    },
  },

  // Phase 7 — VM Provisioning
  {
    name: "VM Provisioning",
    run: async (ctx, spinner) => {
      const { config, keys, tarballPath } = ctx as InitContext;

      // Wait for SSH
      spinner.text = "Waiting for SSH...";
      spinner.start();
      const sshReady = await waitForSsh(config.sshPort);
      if (!sshReady) {
        fail(spinner, "SSH connection timed out");
        throw new Error("SSH connection timed out");
      }
      succeed(spinner, "SSH connected");

      // Upload tarball
      await withSpinner(spinner, "Uploading NEXUS release tarball...", () =>
        sshUploadFile(config.sshPort, tarballPath, "/tmp/nexus-release.tar.gz"),
      );

      // Stage API keys in /tmp (nexus user doesn't exist until cloud-init finishes)
      await withSpinner(spinner, "Staging API keys...", async () => {
        const keysContent = Object.entries(keys)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n") + "\n";
        const tmpKeysPath = path.join(os.tmpdir(), `.nexus-keys-${crypto.randomBytes(8).toString("hex")}`);
        fs.writeFileSync(tmpKeysPath, keysContent, { mode: 0o600 });
        try {
          await sshUploadFile(config.sshPort, tmpKeysPath, "/tmp/.nexus-env-keys");
          await sshExec(config.sshPort, "chmod 600 /tmp/.nexus-env-keys");
        } finally {
          try {
            fs.writeFileSync(tmpKeysPath, "0".repeat(keysContent.length));
            fs.unlinkSync(tmpKeysPath);
          } catch { /* best-effort */ }
        }
      });

      // Wait for cloud-init
      spinner.text = "Cloud-init provisioning — this takes 10-20 min (extracting NEXUS, building Docker, installing deps)...";
      spinner.start();
      const cloudInitDone = await waitForCloudInit(config.sshPort);
      if (!cloudInitDone) {
        fail(spinner, "Cloud-init timed out after 30 minutes");
        log.warn("Check progress: buildwithnexus ssh  →  tail -f /var/log/cloud-init-output.log");
        throw new Error("Cloud-init timed out");
      }
      succeed(spinner, "VM fully provisioned");

      // Move keys into place now that nexus user exists
      await withSpinner(spinner, "Delivering API keys...", () =>
        sshExec(
          config.sshPort,
          "mkdir -p /home/nexus/.nexus && mv /tmp/.nexus-env-keys /home/nexus/.nexus/.env.keys" +
          " && chown -R nexus:nexus /home/nexus/.nexus && chmod 600 /home/nexus/.nexus/.env.keys",
        ),
      );
    },
  },

  // Phase 8 — Server Health
  {
    name: "NEXUS Server Startup",
    run: async (ctx, spinner) => {
      const { config } = ctx as InitContext;
      spinner.text = "Waiting for NEXUS server...";
      spinner.start();
      const serverReady = await waitForServer(config.sshPort);
      if (!serverReady) {
        fail(spinner, "Server failed to start");
        log.warn("Check logs: buildwithnexus logs");
        throw new Error("NEXUS server failed to start");
      }
      succeed(spinner, "NEXUS server healthy on port 4200");
    },
  },

  // Phase 9 — Cloudflare Tunnel
  {
    name: "Cloudflare Tunnel",
    run: async (ctx, spinner) => {
      const { config, platform } = ctx as InitContext;
      if (!config.enableTunnel) {
        log.dim("Skipped (not enabled)");
        return;
      }
      await withSpinner(spinner, "Installing cloudflared...", () =>
        installCloudflared(config.sshPort, platform.arch),
      );
      spinner.text = "Starting tunnel...";
      spinner.start();
      const url = await startTunnel(config.sshPort);
      if (url) {
        ctx.tunnelUrl = url;
        succeed(spinner, `Tunnel active: ${url}`);
      } else {
        fail(spinner, "Tunnel failed to start (server still accessible locally)");
      }
    },
  },

  // Phase 10 — Complete
  {
    name: "Complete",
    run: async (ctx) => {
      showCompletion({ remote: ctx.tunnelUrl, ssh: "buildwithnexus ssh" });
    },
  },
];

// ---------------------------------------------------------------------------
// Helper for phase 2 label
// ---------------------------------------------------------------------------
function hasQemuLabel(installed: boolean): string {
  return installed ? "QEMU ready" : "QEMU installed";
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const TOTAL_PHASES = phases.length;

async function runInit(): Promise<void> {
  const ctx: Partial<InitContext> = { vmLaunched: false, tunnelUrl: undefined };
  const spinner = createSpinner("");

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    showPhase(i + 1, TOTAL_PHASES, phase.name);

    if (phase.skip?.(ctx)) {
      log.dim("Skipped");
      continue;
    }

    try {
      await phase.run(ctx, spinner);
    } catch (err) {
      // Stop the spinner so the error message is clean
      try { spinner.stop(); } catch { /* ignore */ }

      // Clean up the VM if it was launched before the failure
      if (ctx.vmLaunched) {
        process.stderr.write(chalk.dim("\n  Stopping VM due to init failure...\n"));
        try { stopVm(); } catch { /* ignore */ }
      }

      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const initCommand = new Command("init")
  .description("Scaffold and launch a new NEXUS runtime")
  .action(async () => {
    try {
      await runInit();
    } catch (err) {
      const safeErr = redactError(err);
      log.error(`Init failed: ${safeErr.message}`);
      process.exit(1);
    }
  });
