import { dockerExec } from "./docker.js";
import { backoffMs } from "./utils.js";

export interface HealthStatus {
  vmRunning: boolean;
  sshReady: boolean;
  dockerReady: boolean;
  serverHealthy: boolean;
  tunnelUrl: string | null;
  dockerVersion: string | null;
  serverVersion: string | null;
  diskUsagePercent: number | null;
  uptimeSeconds: number | null;
  lastChecked: string;
}

export async function checkHealth(vmRunning: boolean): Promise<HealthStatus> {
  const status: HealthStatus = {
    vmRunning,
    sshReady: false,
    dockerReady: false,
    serverHealthy: false,
    tunnelUrl: null,
    dockerVersion: null,
    serverVersion: null,
    diskUsagePercent: null,
    uptimeSeconds: null,
    lastChecked: new Date().toISOString(),
  };

  if (!vmRunning) return status;

  // SSH is no longer used — mark sshReady true when container is running
  status.sshReady = true;

  // Check Docker inside container
  try {
    const { stdout, code } = await dockerExec("docker version --format '{{.Server.Version}}'");
    status.dockerReady = code === 0 && stdout.trim().length > 0;
    if (status.dockerReady) status.dockerVersion = stdout.trim();
  } catch { /* not ready */ }

  // Check NEXUS server
  try {
    const { stdout, code } = await dockerExec("curl -sf http://localhost:4200/health");
    status.serverHealthy = code === 0 && stdout.includes("ok");
    if (status.serverHealthy) {
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        if (typeof parsed.version === "string") status.serverVersion = parsed.version;
      } catch { /* plain-text ok response */ }
    }
  } catch { /* not ready */ }

  // Check disk usage
  try {
    const { stdout } = await dockerExec("df / --output=pcent | tail -1 | tr -dc '0-9'");
    const pct = parseInt(stdout.trim(), 10);
    if (!isNaN(pct)) status.diskUsagePercent = pct;
  } catch { /* ignore */ }

  // Check uptime
  try {
    const { stdout } = await dockerExec("awk '{print int($1)}' /proc/uptime 2>/dev/null");
    const up = parseInt(stdout.trim(), 10);
    if (!isNaN(up)) status.uptimeSeconds = up;
  } catch { /* ignore */ }

  // Check tunnel
  try {
    const { stdout } = await dockerExec("cat /home/nexus/.nexus/tunnel-url.txt 2>/dev/null");
    if (stdout.includes("https://")) {
      status.tunnelUrl = stdout.trim();
    }
  } catch { /* no tunnel */ }

  return status;
}

export async function waitForServer(timeoutMs: number = 900_000): Promise<boolean> {
  const start = Date.now();
  let lastLog = 0;
  let attempt = 0;

  while (Date.now() - start < timeoutMs) {
    try {
      const { stdout, code } = await dockerExec("curl -sf http://localhost:4200/health");
      if (code === 0 && stdout.includes("ok")) return true;
    } catch { /* not ready yet */ }

    const elapsed = Date.now() - start;
    if (elapsed - lastLog >= 30_000) {
      lastLog = elapsed;
      try {
        const { stdout } = await dockerExec("systemctl is-active nexus 2>/dev/null || echo 'starting...'");
        process.stderr.write(`\n  [server ${Math.round(elapsed / 1000)}s] ${stdout.trim().slice(0, 120)}\n`);
      } catch { /* ignore */ }
    }

    const delay = backoffMs(attempt++);
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
  }
  return false;
}
