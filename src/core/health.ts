import { sshExec } from "./ssh.js";

export interface HealthStatus {
  vmRunning: boolean;
  sshReady: boolean;
  dockerReady: boolean;
  serverHealthy: boolean;
  tunnelUrl: string | null;
}

export async function checkHealth(port: number, vmRunning: boolean): Promise<HealthStatus> {
  const status: HealthStatus = {
    vmRunning,
    sshReady: false,
    dockerReady: false,
    serverHealthy: false,
    tunnelUrl: null,
  };

  if (!vmRunning) return status;

  // Check SSH
  try {
    const { code } = await sshExec(port, "echo ok");
    status.sshReady = code === 0;
  } catch {
    return status;
  }

  // Check Docker
  try {
    const { code } = await sshExec(port, "docker version --format '{{.Server.Version}}'");
    status.dockerReady = code === 0;
  } catch { /* not ready */ }

  // Check NEXUS server
  try {
    const { stdout, code } = await sshExec(port, "curl -sf http://localhost:4200/health");
    status.serverHealthy = code === 0 && stdout.includes("ok");
  } catch { /* not ready */ }

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

    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

export async function waitForCloudInit(port: number, timeoutMs: number = 1_800_000): Promise<boolean> {
  const start = Date.now();
  let lastLog = 0;
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

    await new Promise((r) => setTimeout(r, 20_000));
  }
  return false;
}
