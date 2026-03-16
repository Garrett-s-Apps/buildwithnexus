import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { execa } from "execa";
import { NodeSSH } from "node-ssh";
import { NEXUS_HOME } from "./secrets.js";
import { audit, redact, scrubEnv } from "./dlp.js";
import { isNexusRunning } from "./docker.js";

const SSH_DIR = path.join(NEXUS_HOME, "ssh");
const SSH_KEY = path.join(SSH_DIR, "id_nexus_vm");
const SSH_PUB_KEY = path.join(SSH_DIR, "id_nexus_vm.pub");
const KNOWN_HOSTS = path.join(SSH_DIR, "known_hosts_nexus_vm");
const PINNED_HOST_KEY = path.join(SSH_DIR, "vm_host_key.pin");

enum SshErrorCategory {
  Transient = "transient",
  AuthFailure = "auth_failure",
  HostKeyMismatch = "host_key_mismatch",
  Timeout = "timeout",
  Unknown = "unknown",
}

function classifySshError(err: Error): SshErrorCategory {
  const msg = err.message || '';
  if (msg.includes('All configured authentication methods')) return SshErrorCategory.AuthFailure;
  if (msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET')) return SshErrorCategory.Transient;
  if (msg.includes('Host denied (verification failed)')) return SshErrorCategory.HostKeyMismatch;
  if (msg.includes('Timed out')) return SshErrorCategory.Timeout;
  return SshErrorCategory.Unknown;
}

function getHostVerifier(): (key: Buffer) => boolean {
  if (!fs.existsSync(PINNED_HOST_KEY)) {
    return (key: Buffer) => {
      const fp = crypto.createHash("sha256").update(key).digest("base64");
      fs.writeFileSync(PINNED_HOST_KEY, fp, { mode: 0o600 });
      audit("ssh_exec", `host key pinned: SHA256:${fp}`);
      return true;
    };
  }
  const pinned = fs.readFileSync(PINNED_HOST_KEY, "utf-8").trim();
  return (key: Buffer) => {
    const fp = crypto.createHash("sha256").update(key).digest("base64");
    const match = fp === pinned;
    if (!match) audit("ssh_exec", `host key mismatch: expected ${pinned}, got ${fp}`);
    return match;
  };
}

export function getKeyPath(): string {
  return SSH_KEY;
}

export function getPubKey(): string {
  return fs.readFileSync(SSH_PUB_KEY, "utf-8").trim();
}

export async function generateSshKey(): Promise<void> {
  if (fs.existsSync(SSH_KEY)) return;
  fs.mkdirSync(SSH_DIR, { recursive: true });
  await execa("ssh-keygen", [
    "-t", "ed25519",
    "-f", SSH_KEY,
    "-N", "",
    "-C", "buildwithnexus@localhost",
    "-q",
  ], { env: scrubEnv() });
  fs.chmodSync(SSH_KEY, 0o600);
  fs.chmodSync(SSH_PUB_KEY, 0o644);
}

export function addSshConfig(port: number): void {
  const sshConfigPath = path.join(process.env.HOME || "~", ".ssh", "config");
  const sshDir = path.dirname(sshConfigPath);
  fs.mkdirSync(sshDir, { recursive: true });

  const block = [
    "",
    "Host nexus-vm",
    "    HostName localhost",
    `    Port ${port}`,
    "    User nexus",
    `    IdentityFile ${SSH_KEY}`,
    "    StrictHostKeyChecking accept-new",
    `    UserKnownHostsFile ${KNOWN_HOSTS}`,
    "    ServerAliveInterval 60",
    "",
  ].join("\n");

  if (fs.existsSync(sshConfigPath)) {
    const existing = fs.readFileSync(sshConfigPath, "utf-8");
    if (existing.includes("Host nexus-vm")) return;
    fs.appendFileSync(sshConfigPath, block);
  } else {
    fs.writeFileSync(sshConfigPath, block, { mode: 0o600 });
  }
}


async function isTcpPortOpen(port: number, timeoutMs: number = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "localhost", port });
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

export async function probeVmReady(
  port: number
): Promise<"not_reachable" | "sshd_up_user_missing" | "ready"> {
  // TCP pre-probe (port open?)
  if (!(await isTcpPortOpen(port))) {
    return "not_reachable";
  }

  // Try to connect as nexus with key
  try {
    const ssh = new NodeSSH();
    await ssh.connect({
      host: "localhost",
      port,
      username: "nexus",
      privateKeyPath: SSH_KEY,
      readyTimeout: 3000,
      hostVerifier: getHostVerifier(),
    });
    ssh.dispose();
    return "ready";
  } catch (err) {
    // Classify the error to distinguish transient from fatal conditions
    const category = classifySshError(err instanceof Error ? err : new Error(String(err)));
    if (category === SshErrorCategory.AuthFailure) {
      return "sshd_up_user_missing";
    }
    // Other errors (host key mismatch, timeout, etc.) → not ready yet
    return "not_reachable";
  }
}

export async function waitForSsh(port: number, timeoutMs: number = 900_000): Promise<boolean> {
  const start = Date.now();
  let lastLogAt = 0;
  let attempt = 0;
  let lastCategory = "";
  let firstErrorLogged = false;
  // Exponential backoff: 3s -> 6s -> 12s -> 30s cap
  const backoffMs = (n: number) => Math.min(3000 * Math.pow(2, n), 30_000);

  while (Date.now() - start < timeoutMs) {
    // Docker container liveness guard: fail fast if container is dead
    if (!(await isNexusRunning())) {
      process.stderr.write(`\n  [ssh] NEXUS container is not running — aborting SSH wait\n`);
      return false;
    }

    attempt++;

    let probeResult: "not_reachable" | "sshd_up_user_missing" | "ready";
    try {
      probeResult = await probeVmReady(port);
    } catch (err) {
      // Classify unexpected errors from probeVmReady
      const category = classifySshError(err instanceof Error ? err : new Error(String(err)));
      if (category === SshErrorCategory.HostKeyMismatch) {
        process.stderr.write(
          `\n  [ssh] FATAL: Host key mismatch detected on port ${port}. ` +
          `The VM host key does not match the pinned key. ` +
          `Remove ${PINNED_HOST_KEY} if the VM was recreated.\n`
        );
        return false;
      }
      probeResult = "not_reachable";
    }

    if (probeResult === "ready") {
      return true;
    }

    if (probeResult === "sshd_up_user_missing") {
      lastCategory = "auth_pending";
      if (!firstErrorLogged) {
        firstErrorLogged = true;
        process.stderr.write(
          `\n  [ssh] SSH daemon active but nexus user not yet created (cloud-init in progress)\n`
        );
      }
    } else {
      // not_reachable
      lastCategory = "port_not_reachable";
      if (!firstErrorLogged) {
        firstErrorLogged = true;
        process.stderr.write(
          `\n  [ssh] Port ${port} not reachable — waiting for VM to start SSH daemon\n`
        );
      }
    }

    const elapsed = Date.now() - start;
    if (elapsed - lastLogAt >= 30_000) {
      lastLogAt = elapsed;
      const containerStatus = await isNexusRunning() ? "running" : "stopped";
      const detail = lastCategory === "auth_pending"
        ? "SSH daemon active but nexus user not yet created"
        : "port not reachable";
      process.stderr.write(
        `\n  [ssh ${Math.round(elapsed / 1000)}s] attempt ${attempt} | category: ${lastCategory} | Container: ${containerStatus} | ${detail}\n`
      );
    }

    const delay = backoffMs(attempt - 1);
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
  }

  const totalElapsed = Math.round((Date.now() - start) / 1000);
  process.stderr.write(
    `\n  [ssh] Timed out after ${totalElapsed}s (${attempt} attempts) waiting for SSH on port ${port} — last category: ${lastCategory}\n`
  );
  return false;
}

export async function sshExec(port: number, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  audit("ssh_exec", redact(command));
  const ssh = new NodeSSH();
  await ssh.connect({
    host: "localhost",
    port,
    username: "nexus",
    privateKeyPath: SSH_KEY,
    readyTimeout: 30_000,
    hostVerifier: getHostVerifier(),
  });
  const result = await ssh.execCommand(command);
  ssh.dispose();
  return { stdout: redact(result.stdout), stderr: redact(result.stderr), code: result.code ?? 0 };
}

export async function sshUploadFile(port: number, localPath: string, remotePath: string): Promise<void> {
  const ssh = new NodeSSH();
  await ssh.connect({
    host: "localhost",
    port,
    username: "nexus",
    privateKeyPath: SSH_KEY,
    hostVerifier: getHostVerifier(),
  });
  await ssh.putFile(localPath, remotePath);
  ssh.dispose();
}

export async function openInteractiveSsh(port: number): Promise<void> {
  await execa("ssh", ["nexus-vm"], { stdio: "inherit", env: scrubEnv() });
}
