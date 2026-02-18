import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execa } from "execa";
import { NodeSSH } from "node-ssh";
import { NEXUS_HOME } from "./secrets.js";
import { audit, redact, scrubEnv } from "./dlp.js";

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

export async function waitForSsh(port: number, timeoutMs: number = 300_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ssh = new NodeSSH();
      await ssh.connect({
        host: "localhost",
        port,
        username: "nexus",
        privateKeyPath: SSH_KEY,
        readyTimeout: 5000,
        hostVerifier: getHostVerifier(),
      });
      ssh.dispose();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
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
    hostVerifier: getHostVerifier(),
  });
  const result = await ssh.execCommand(command);
  ssh.dispose();
  return { stdout: result.stdout, stderr: result.stderr, code: result.code ?? 0 };
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
