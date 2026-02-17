import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { NodeSSH } from "node-ssh";
import { NEXUS_HOME } from "./secrets.js";

const SSH_DIR = path.join(NEXUS_HOME, "ssh");
const SSH_KEY = path.join(SSH_DIR, "id_nexus_vm");
const SSH_PUB_KEY = path.join(SSH_DIR, "id_nexus_vm.pub");
const KNOWN_HOSTS = path.join(SSH_DIR, "known_hosts_nexus_vm");

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
  ]);
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
    "    ForwardAgent yes",
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
  const ssh = new NodeSSH();
  await ssh.connect({
    host: "localhost",
    port,
    username: "nexus",
    privateKeyPath: SSH_KEY,
  });
  const result = await ssh.execCommand(command);
  ssh.dispose();
  return { stdout: result.stdout, stderr: result.stderr, code: result.code ?? 0 };
}

export async function openInteractiveSsh(port: number): Promise<void> {
  await execa("ssh", ["nexus-vm"], { stdio: "inherit" });
}
