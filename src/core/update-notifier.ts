import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import chalk from "chalk";

const PACKAGE_NAME = "buildwithnexus";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STATE_DIR = path.join(os.homedir(), ".buildwithnexus");
const STATE_FILE = path.join(STATE_DIR, ".update-check.json");

interface UpdateState {
  lastCheck: number;
  latestVersion: string | null;
}

function readState(): UpdateState {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw) as UpdateState;
  } catch {
    return { lastCheck: 0, latestVersion: null };
  }
}

function writeState(state: UpdateState): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
  } catch { /* best-effort */ }
}

function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      { headers: { Accept: "application/json" }, timeout: 5000 },
      (res) => {
        if (res.statusCode !== 200) { resolve(null); res.resume(); return; }
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data) as { version?: string };
            resolve(parsed.version ?? null);
          } catch { resolve(null); }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function compareVersions(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const c = parse(current);
  const l = parse(latest);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

export async function checkForUpdates(currentVersion: string): Promise<void> {
  const state = readState();

  if (Date.now() - state.lastCheck < CHECK_INTERVAL_MS) {
    // Show cached result if we have one
    if (state.latestVersion && compareVersions(currentVersion, state.latestVersion)) {
      printUpdateBanner(currentVersion, state.latestVersion);
    }
    return;
  }

  // Fetch in background — don't block CLI startup
  fetchLatestVersion().then((latest) => {
    writeState({ lastCheck: Date.now(), latestVersion: latest });
    if (latest && compareVersions(currentVersion, latest)) {
      printUpdateBanner(currentVersion, latest);
    }
  }).catch(() => { /* never block CLI */ });
}

function printUpdateBanner(current: string, latest: string): void {
  const msg = [
    "",
    chalk.yellow(`  Update available: ${current} → ${latest}`),
    chalk.cyan(`  Run: npm update -g buildwithnexus`),
    "",
  ].join("\n");
  process.stderr.write(msg + "\n");
}
