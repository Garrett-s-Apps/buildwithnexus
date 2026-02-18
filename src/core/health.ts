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

export async function waitForServer(port: number, timeoutMs: number = 600_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { stdout, code } = await sshExec(port, "curl -sf http://localhost:4200/health");
      if (code === 0 && stdout.includes("ok")) return true;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return false;
}

export async function waitForCloudInit(port: number, timeoutMs: number = 900_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { code } = await sshExec(port, "test -f /var/lib/cloud/instance/boot-finished");
      if (code === 0) return true;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return false;
}
