import { sshExec } from "./ssh.js";

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

export async function checkHealth(port: number, vmRunning: boolean): Promise<HealthStatus> {
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

  // Check SSH
  try {
    const { code } = await sshExec(port, "echo ok");
    status.sshReady = code === 0;
  } catch {
    return status;
  }

  // Check Docker (capture version)
  try {
    const { stdout, code } = await sshExec(port, "docker version --format '{{.Server.Version}}'");
    status.dockerReady = code === 0 && stdout.trim().length > 0;
    if (status.dockerReady) status.dockerVersion = stdout.trim();
  } catch { /* not ready */ }

  // Check NEXUS server (capture version if exposed)
  try {
    const { stdout, code } = await sshExec(port, "curl -sf http://localhost:4200/health");
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
    const { stdout } = await sshExec(port, "df / --output=pcent | tail -1 | tr -dc '0-9'");
    const pct = parseInt(stdout.trim(), 10);
    if (!isNaN(pct)) status.diskUsagePercent = pct;
  } catch { /* ignore */ }

  // Check uptime
  try {
    const { stdout } = await sshExec(port, "awk '{print int($1)}' /proc/uptime 2>/dev/null");
    const up = parseInt(stdout.trim(), 10);
    if (!isNaN(up)) status.uptimeSeconds = up;
  } catch { /* ignore */ }

  // Check tunnel
  try {
    const { stdout } = await sshExec(port, "cat /home/nexus/.nexus/tunnel-url.txt 2>/dev/null");
    if (stdout.includes("https://")) {
      status.tunnelUrl = stdout.trim();
    }
  } catch { /* no tunnel */ }

  return status;
}

export async function waitForServer(port: number, timeoutMs: number = 900_000): Promise<boolean> {
  const start = Date.now();
  let lastLog = 0;
  let attempt = 0;
  // Exponential backoff: 3s → 6s → 12s → 30s max
  const backoffMs = (n: number) => Math.min(3000 * Math.pow(2, n), 30_000);

  while (Date.now() - start < timeoutMs) {
    try {
      const { stdout, code } = await sshExec(port, "curl -sf http://localhost:4200/health");
      if (code === 0 && stdout.includes("ok")) return true;
    } catch { /* not ready yet */ }

    const elapsed = Date.now() - start;
    if (elapsed - lastLog >= 30_000) {
      lastLog = elapsed;
      try {
        const { stdout } = await sshExec(port, "systemctl is-active nexus 2>/dev/null || echo 'starting...'");
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

export async function waitForCloudInit(port: number, timeoutMs: number = 1_800_000): Promise<boolean> {
  const start = Date.now();
  let lastLog = 0;
  let attempt = 0;
  // Exponential backoff: 3s → 6s → 12s → 30s max (cloud-init takes minutes, cap keeps progress visible)
  const backoffMs = (n: number) => Math.min(3000 * Math.pow(2, n), 30_000);

  while (Date.now() - start < timeoutMs) {
    try {
      const { code } = await sshExec(port, "test -f /var/lib/cloud/instance/boot-finished");
      if (code === 0) return true;
    } catch { /* not ready */ }

    const elapsed = Date.now() - start;
    if (elapsed - lastLog >= 60_000) {
      lastLog = elapsed;
      try {
        const { stdout } = await sshExec(port, "tail -1 /var/log/cloud-init-output.log 2>/dev/null || echo 'waiting...'");
        process.stderr.write(`\n  [cloud-init ${Math.round(elapsed / 1000)}s] ${stdout.trim().slice(0, 120)}\n`);
      } catch { /* ignore */ }
    }

    const delay = backoffMs(attempt++);
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
  }
  return false;
}
