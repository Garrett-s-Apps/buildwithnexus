import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { execa } from "execa";
import { NodeSSH } from "node-ssh";
import { NEXUS_HOME } from "./secrets.js";
import { audit, redact, scrubEnv } from "./dlp.js";
import { isVmRunning } from "./qemu.js";

const SSH_DIR = path.join(NEXUS_HOME, "ssh");
const SSH_KEY = path.join(SSH_DIR, "id_nexus_vm");
const SSH_PUB_KEY = path.join(SSH_DIR, "id_nexus_vm.pub");
const KNOWN_HOSTS = path.join(SSH_DIR, "known_hosts_nexus_vm");
const PINNED_HOST_KEY = path.join(SSH_DIR, "vm_host_key.pin");

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

export async function waitForSsh(port: number, timeoutMs: number = 900_000): Promise<boolean> {
  const start = Date.now();
  let lastLog = 0;
  let attempt = 0;
  let lastError = "";
  // Exponential backoff: 3s -> 6s -> 12s -> 30s cap
  const backoffMs = (n: number) => Math.min(3000 * Math.pow(2, n), 30_000);

  while (Date.now() - start < timeoutMs) {
    // QEMU liveness guard: fail fast if VM is dead
    if (!isVmRunning()) {
      process.stderr.write(`\n  [ssh] QEMU process is not running — aborting SSH wait\n`);
      return false;
    }

    // TCP pre-probe: skip SSH handshake if port is not even open
    const tcpOpen = await isTcpPortOpen(port);
    if (!tcpOpen) {
      lastError = "ECONNREFUSED (TCP pre-probe)";
    } else {
      try {
        const ssh = new NodeSSH();
        await ssh.connect({
          host: "localhost",
          port,
          username: "nexus",
          privateKeyPath: SSH_KEY,
          readyTimeout: 10_000,
          hostVerifier: getHostVerifier(),
        });
        ssh.dispose();
        return true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    const elapsed = Date.now() - start;
    if (elapsed - lastLog >= 30_000) {
      lastLog = elapsed;
      process.stderr.write(`\n  [ssh ${Math.round(elapsed / 1000)}s] waiting for SSH on port ${port} — ${lastError}\n`);
    }

    const delay = backoffMs(attempt++);
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
  }
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
