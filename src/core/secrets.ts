import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const NEXUS_HOME = path.join(process.env.HOME || "~", ".buildwithnexus");
export const CONFIG_PATH = path.join(NEXUS_HOME, "config.json");
export const KEYS_PATH = path.join(NEXUS_HOME, ".env.keys");

export interface NexusConfig {
  vmRam: number;
  vmCpus: number;
  vmDisk: number;
  enableTunnel: boolean;
  sshPort: number;
  httpPort: number;
  httpsPort: number;
  masterSecret?: string;
}

export interface NexusKeys {
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  NEXUS_MASTER_SECRET: string;
}

export function ensureHome(): void {
  fs.mkdirSync(NEXUS_HOME, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(NEXUS_HOME, "vm", "images"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(NEXUS_HOME, "vm", "configs"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(NEXUS_HOME, "vm", "logs"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(NEXUS_HOME, "ssh"), { recursive: true, mode: 0o700 });
}

export function generateMasterSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function saveConfig(config: NexusConfig): void {
  // Exclude masterSecret from config — it lives only in .env.keys (0o600)
  const { masterSecret: _secret, ...safeConfig } = config;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(safeConfig, null, 2), { mode: 0o600 });
}

export function loadConfig(): NexusConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

export function saveKeys(keys: NexusKeys): void {
  const lines = Object.entries(keys)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(KEYS_PATH, lines.join("\n") + "\n", { mode: 0o600 });
}

export function loadKeys(): NexusKeys | null {
  if (!fs.existsSync(KEYS_PATH)) return null;
  const content = fs.readFileSync(KEYS_PATH, "utf-8");
  const keys: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) keys[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return keys as unknown as NexusKeys;
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 4) + "..." + key.slice(-4);
}
