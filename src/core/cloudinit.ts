import fs from "node:fs";
import path from "node:path";
import ejs from "ejs";
import { execa } from "execa";
import { NEXUS_HOME } from "./secrets.js";
import type { NexusConfig, NexusKeys } from "./secrets.js";
import { yamlEscape, audit, scrubEnv } from "./dlp.js";

const CONFIGS_DIR = path.join(NEXUS_HOME, "vm", "configs");
const IMAGES_DIR = path.join(NEXUS_HOME, "vm", "images");

interface CloudInitData {
  sshPubKey: string;
  keys: NexusKeys;
  config: NexusConfig;
}

export async function renderCloudInit(data: CloudInitData, templateContent: string): Promise<string> {
  const safeKeys: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.keys)) {
    if (v) safeKeys[k] = yamlEscape(v as string);
  }
  const safeData = { ...data, keys: safeKeys };

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

  // Try mkisofs first, then genisoimage
  try {
    await execa("mkisofs", [
      "-output", isoPath,
      "-volid", "cidata",
      "-joliet", "-rock",
      userDataPath,
      metaDataPath,
    ], { env });
  } catch {
    await execa("genisoimage", [
      "-output", isoPath,
      "-volid", "cidata",
      "-joliet", "-rock",
      userDataPath,
      metaDataPath,
    ], { env });
  }

  // Restrict ISO permissions and clean up plaintext key files
  fs.chmodSync(isoPath, 0o600);
  fs.unlinkSync(userDataPath);
  fs.unlinkSync(metaDataPath);
  audit("cloudinit_plaintext_deleted", "user-data.yaml and meta-data.yaml removed");
  audit("cloudinit_iso_created", "init.iso created");

  return isoPath;
}
