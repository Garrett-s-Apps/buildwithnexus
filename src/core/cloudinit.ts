import fs from "node:fs";
import path from "node:path";
import ejs from "ejs";
import { execa } from "execa";
import { NEXUS_HOME } from "./secrets.js";
import type { NexusConfig, NexusKeys } from "./secrets.js";
import { yamlEscape, audit, scrubEnv, DlpViolation } from "./dlp.js";

const CONFIGS_DIR = path.join(NEXUS_HOME, "vm", "configs");
const IMAGES_DIR = path.join(NEXUS_HOME, "vm", "images");

interface CloudInitData {
  sshPubKey: string;
  keys: NexusKeys;
  config: NexusConfig;
}

export async function renderCloudInit(data: CloudInitData, templateContent: string): Promise<string> {
  // Validate SSH public key format before embedding in YAML
  const trimmedPubKey = data.sshPubKey.trim();
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/=]+ ?\S*$/.test(trimmedPubKey)) {
    throw new DlpViolation("SSH public key has unexpected format — possible injection attempt");
  }

  const safeKeys: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.keys)) {
    if (v) safeKeys[k] = yamlEscape(v as string);
  }
  const safeData = { ...data, sshPubKey: yamlEscape(trimmedPubKey), keys: safeKeys };

  const rendered = ejs.render(templateContent, safeData);
  const outputPath = path.join(CONFIGS_DIR, "user-data.yaml");
  fs.writeFileSync(outputPath, rendered, { mode: 0o600 });
  audit("cloudinit_rendered", "user-data.yaml written");
  return outputPath;
}

export async function createCloudInitIso(userDataPath: string): Promise<string> {
  const metaDataPath = path.join(CONFIGS_DIR, "meta-data.yaml");
  fs.writeFileSync(metaDataPath, "instance-id: nexus-vm-1\nlocal-hostname: nexus-vm\n", { mode: 0o600 });

  const isoPath = path.join(IMAGES_DIR, "init.iso");
  const env = scrubEnv();

  try {
    // Try mkisofs and genisoimage (identical args)
    let created = false;
    for (const tool of ["mkisofs", "genisoimage"]) {
      if (created) break;
      try {
        await execa(tool, [
          "-output", isoPath,
          "-volid", "cidata",
          "-joliet", "-rock",
          userDataPath,
          metaDataPath,
        ], { env });
        created = true;
      } catch { /* tool not available */ }
    }

    // macOS fallback: hdiutil makehybrid (built-in, no Homebrew needed)
    if (!created) {
      try {
        const stagingDir = path.join(CONFIGS_DIR, "cidata-staging");
        fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
        fs.copyFileSync(userDataPath, path.join(stagingDir, "user-data"));
        fs.copyFileSync(metaDataPath, path.join(stagingDir, "meta-data"));
        await execa("hdiutil", [
          "makehybrid",
          "-o", isoPath,
          "-joliet",
          "-iso",
          "-default-volume-name", "cidata",
          stagingDir,
        ], { env });
        fs.rmSync(stagingDir, { recursive: true, force: true });
        created = true;
      } catch { /* not available */ }
    }

    if (!created) {
      throw new Error(
        "Cannot create cloud-init ISO: none of mkisofs, genisoimage, or hdiutil are available. " +
        "On macOS, install cdrtools: brew install cdrtools. " +
        "On Linux: sudo apt install genisoimage",
      );
    }

    fs.chmodSync(isoPath, 0o600);
    audit("cloudinit_iso_created", "init.iso created");
    return isoPath;
  } finally {
    // Guarantee plaintext key files are removed even if ISO creation fails
    try { fs.unlinkSync(userDataPath); } catch { /* ignore */ }
    try { fs.unlinkSync(metaDataPath); } catch { /* ignore */ }
    audit("cloudinit_plaintext_deleted", "user-data.yaml and meta-data.yaml removed");
  }
}
