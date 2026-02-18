import { Command } from "commander";
import chalk from "chalk";
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
  isQemuInstalled,
  installQemu,
  downloadImage,
  createDisk,
  launchVm,
  isVmRunning,
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

function getReleaseTarball(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const tarballPath = path.join(dir, "nexus-release.tar.gz");
  if (fs.existsSync(tarballPath)) return tarballPath;
  // Fallback: check relative to project root
  const rootPath = path.resolve(dir, "..", "dist", "nexus-release.tar.gz");
  if (fs.existsSync(rootPath)) return rootPath;
  throw new Error("nexus-release.tar.gz not found. Run: npm run bundle");
}

const TOTAL_PHASES = 10;

// Read the cloud-init template (bundled by tsup)
function getCloudInitTemplate(): string {
  // At build time, tsup bundles the template. At dev time, read from file.
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.join(dir, "templates", "cloud-init.yaml.ejs");
  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, "utf-8");
  }
  // Fallback: try relative to src
  const srcPath = path.resolve(dir, "..", "src", "templates", "cloud-init.yaml.ejs");
  return fs.readFileSync(srcPath, "utf-8");
}

export const initCommand = new Command("init")
  .description("Scaffold and launch a new NEXUS runtime")
  .action(async () => {
    try {
      // Phase 1: Welcome + Config
      showBanner();
      showPhase(1, TOTAL_PHASES, "Configuration");
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

      // Phase 2: QEMU
      showPhase(2, TOTAL_PHASES, "QEMU Installation");
      let spinner = createSpinner("Checking QEMU...");
      spinner.start();
      const hasQemu = await isQemuInstalled(platform);
      if (hasQemu) {
        succeed(spinner, "QEMU already installed");
      } else {
        spinner.text = "Installing QEMU...";
        await installQemu(platform);
        succeed(spinner, "QEMU installed");
      }

      // Phase 3: SSH Keys
      showPhase(3, TOTAL_PHASES, "SSH Key Setup");
      spinner = createSpinner("Generating SSH key...");
      spinner.start();
      await generateSshKey();
      addSshConfig(config.sshPort);
      succeed(spinner, "SSH key ready (ed25519)");

      // Phase 4: Ubuntu Image
      showPhase(4, TOTAL_PHASES, "VM Image Download");
      spinner = createSpinner(`Downloading Ubuntu 24.04 (${platform.ubuntuImage})...`);
      spinner.start();
      const imagePath = await downloadImage(platform);
      succeed(spinner, "Ubuntu image ready");

      // Phase 5: Cloud-Init
      showPhase(5, TOTAL_PHASES, "Cloud-Init Generation");
      spinner = createSpinner("Locating release tarball...");
      spinner.start();
      const tarballPath = getReleaseTarball();
      succeed(spinner, `Release tarball found (${path.basename(tarballPath)})`);

      spinner = createSpinner("Rendering cloud-init...");
      spinner.start();
      const pubKey = getPubKey();
      const template = getCloudInitTemplate();
      const userDataPath = await renderCloudInit({ sshPubKey: pubKey, keys, config }, template);
      const isoPath = await createCloudInitIso(userDataPath);
      succeed(spinner, "Cloud-init ISO created");

      // Phase 6: VM Boot
      showPhase(6, TOTAL_PHASES, "VM Launch");
      spinner = createSpinner("Creating disk and launching VM...");
      spinner.start();
      const diskPath = await createDisk(imagePath, config.vmDisk);
      await launchVm(platform, diskPath, isoPath, config.vmRam, config.vmCpus, {
        ssh: config.sshPort,
        http: config.httpPort,
        https: config.httpsPort,
      });
      succeed(spinner, "VM launched (daemonized)");

      // Phase 7: Cloud-Init Provisioning
      showPhase(7, TOTAL_PHASES, "VM Provisioning");
      spinner = createSpinner("Waiting for SSH...");
      spinner.start();
      const sshReady = await waitForSsh(config.sshPort);
      if (!sshReady) {
        fail(spinner, "SSH connection timed out");
        process.exit(1);
      }
      succeed(spinner, "SSH connected");

      spinner = createSpinner("Uploading NEXUS release tarball...");
      spinner.start();
      await sshUploadFile(config.sshPort, tarballPath, "/tmp/nexus-release.tar.gz");
      succeed(spinner, "Tarball uploaded");

      // Securely deliver API keys via SSH (not embedded in cloud-init ISO)
      spinner = createSpinner("Uploading API keys via SSH...");
      spinner.start();
      const keysContent = Object.entries(keys)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n";
      const tmpKeysPath = path.join(os.tmpdir(), `.nexus-keys-${crypto.randomBytes(8).toString("hex")}`);
      fs.writeFileSync(tmpKeysPath, keysContent, { mode: 0o600 });
      try {
        await sshExec(config.sshPort, "sudo -u nexus mkdir -p /home/nexus/.nexus");
        await sshUploadFile(config.sshPort, tmpKeysPath, "/home/nexus/.nexus/.env.keys");
        await sshExec(config.sshPort, "chown nexus:nexus /home/nexus/.nexus/.env.keys && chmod 600 /home/nexus/.nexus/.env.keys");
      } finally {
        try {
          fs.writeFileSync(tmpKeysPath, "0".repeat(keysContent.length));
          fs.unlinkSync(tmpKeysPath);
        } catch { /* best-effort cleanup */ }
      }
      succeed(spinner, "API keys delivered securely via SSH");

      spinner = createSpinner("Cloud-init provisioning (extracting NEXUS, building Docker, installing deps)...");
      spinner.start();
      const cloudInitDone = await waitForCloudInit(config.sshPort);
      if (!cloudInitDone) {
        fail(spinner, "Cloud-init timed out");
        log.warn("You can check progress with: buildwithnexus ssh then: tail -f /var/log/cloud-init-output.log");
        process.exit(1);
      }
      succeed(spinner, "VM fully provisioned");

      // Phase 8: Server Health
      showPhase(8, TOTAL_PHASES, "NEXUS Server Startup");
      spinner = createSpinner("Waiting for NEXUS server...");
      spinner.start();
      const serverReady = await waitForServer(config.sshPort);
      if (!serverReady) {
        fail(spinner, "Server failed to start");
        log.warn("Check logs: buildwithnexus logs");
        process.exit(1);
      }
      succeed(spinner, "NEXUS server healthy on port 4200");

      // Phase 9: Tunnel
      let tunnelUrl: string | undefined;
      if (config.enableTunnel) {
        showPhase(9, TOTAL_PHASES, "Cloudflare Tunnel");
        spinner = createSpinner("Installing cloudflared...");
        spinner.start();
        await installCloudflared(config.sshPort, platform.arch);
        spinner.text = "Starting tunnel...";
        const url = await startTunnel(config.sshPort);
        if (url) {
          tunnelUrl = url;
          succeed(spinner, `Tunnel active: ${url}`);
        } else {
          fail(spinner, "Tunnel failed to start (server still accessible locally)");
        }
      } else {
        showPhase(9, TOTAL_PHASES, "Cloudflare Tunnel");
        log.dim("Skipped (not enabled)");
      }

      // Phase 10: Done
      showPhase(10, TOTAL_PHASES, "Complete");
      showCompletion({
        remote: tunnelUrl,
        ssh: "buildwithnexus ssh",
      });

    } catch (err) {
      const safeErr = redactError(err);
      log.error(`Init failed: ${safeErr.message}`);
      process.exit(1);
    }
  });
