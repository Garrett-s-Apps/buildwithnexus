import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execa, execaSync } from "execa";
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import type { PlatformInfo } from "./platform.js";
import { NEXUS_HOME } from "./secrets.js";
import { scrubEnv } from "./dlp.js";

const VM_DIR = path.join(NEXUS_HOME, "vm");
const IMAGES_DIR = path.join(VM_DIR, "images");
const PID_FILE = path.join(VM_DIR, "qemu.pid");

const UBUNTU_BASE_URL = "https://cloud-images.ubuntu.com/jammy/current";

export async function isQemuInstalled(platform: PlatformInfo): Promise<boolean> {
  try {
    await execa(platform.qemuBinary, ["--version"], { env: scrubEnv() });
    return true;
  } catch {
    return false;
  }
}

export async function installQemu(platform: PlatformInfo): Promise<void> {
  if (platform.os === "mac") {
    await execa("brew", ["install", "qemu", "cdrtools"], { stdio: "inherit", env: scrubEnv() });
  } else if (platform.os === "linux") {
    // Detect package manager before attempting install
    let hasApt = false;
    try {
      await execa("which", ["apt-get"], { env: scrubEnv() });
      hasApt = true;
    } catch { /* apt-get not available */ }

    if (hasApt) {
      await execa("sudo", ["apt-get", "update"], { stdio: "inherit", env: scrubEnv() });
      await execa("sudo", ["apt-get", "install", "-y", "qemu-system", "qemu-utils", "genisoimage"], { stdio: "inherit", env: scrubEnv() });
    } else {
      await execa("sudo", ["yum", "install", "-y", "qemu-system-arm", "qemu-system-x86", "qemu-img", "genisoimage"], { stdio: "inherit", env: scrubEnv() });
    }
  } else {
    throw new Error("Windows: Please install QEMU manually from https://www.qemu.org/download/#windows");
  }
}

export async function downloadImage(platform: PlatformInfo): Promise<string> {
  const imagePath = path.join(IMAGES_DIR, platform.ubuntuImage);
  if (fs.existsSync(imagePath)) return imagePath;

  const url = `${UBUNTU_BASE_URL}/${platform.ubuntuImage}`;
  await execa("curl", ["-L", "-C", "-", "-o", imagePath, "--progress-bar", url], { stdio: "inherit", env: scrubEnv() });
  return imagePath;
}

export async function createDisk(basePath: string, sizeGb: number): Promise<string> {
  const diskPath = path.join(IMAGES_DIR, "nexus-vm-disk.qcow2");
  if (fs.existsSync(diskPath)) return diskPath;

  await execa("qemu-img", ["create", "-f", "qcow2", "-b", basePath, "-F", "qcow2", diskPath, `${sizeGb}G`], { env: scrubEnv() });
  return diskPath;
}

function tryBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function isPortFree(port: number): Promise<boolean> {
  const free0 = await tryBind(port, "0.0.0.0");
  if (!free0) return false;
  const free1 = await tryBind(port, "127.0.0.1");
  return free1;
}

interface PortBlocker {
  port: number;
  pid: number;
  process: string;
}

async function getPortBlocker(port: number): Promise<PortBlocker | null> {
  try {
    const { stdout } = await execa("lsof", ["-i", `:${port}`, "-t", "-sTCP:LISTEN"], { env: scrubEnv() });
    const pid = parseInt(stdout.trim().split("\n")[0], 10);
    if (!pid) return null;
    try {
      const { stdout: psOut } = await execa("ps", ["-p", String(pid), "-o", "comm="], { env: scrubEnv() });
      return { port, pid, process: psOut.trim() };
    } catch {
      return { port, pid, process: "unknown" };
    }
  } catch {
    return null;
  }
}

async function findFreePort(preferred: number, max = 20): Promise<number> {
  for (let offset = 0; offset < max; offset++) {
    if (await isPortFree(preferred + offset)) return preferred + offset;
  }
  throw new Error(`No free port found near ${preferred}`);
}

export interface ResolvedPorts {
  ssh: number;
  http: number;
  https: number;
}

export async function resolvePortConflicts(
  ports: { ssh: number; http: number; https: number },
): Promise<ResolvedPorts> {
  const labels: Record<string, string> = { ssh: "SSH", http: "HTTP", https: "HTTPS" };
  const resolved = { ...ports };

  for (const [key, port] of Object.entries(ports) as [keyof typeof ports, number][]) {
    if (await isPortFree(port)) continue;

    const blocker = await getPortBlocker(port);
    const desc = blocker
      ? `${blocker.process} (PID ${blocker.pid})`
      : "unknown process";

    const altPort = await findFreePort(port + 1).catch(() => null);

    const choices: { name: string; value: string }[] = [];
    if (blocker) {
      choices.push({
        name: `Kill ${desc} and use port ${port}`,
        value: "kill",
      });
    }
    if (altPort) {
      choices.push({
        name: `Use alternate port ${altPort} instead`,
        value: "alt",
      });
    }
    choices.push({ name: "Abort init", value: "abort" });

    console.log("");
    console.log(chalk.yellow(`  ⚠ Port ${port} (${labels[key]}) is in use by ${desc}`));

    const action = await select({
      message: `How would you like to resolve the ${labels[key]} port conflict?`,
      choices,
    });

    if (action === "kill" && blocker) {
      try {
        process.kill(blocker.pid, "SIGTERM");
        await new Promise((r) => setTimeout(r, 1000));
        if (!(await isPortFree(port))) {
          process.kill(blocker.pid, "SIGKILL");
          await new Promise((r) => setTimeout(r, 500));
        }
        console.log(chalk.green(`  ✓ Killed ${desc}, port ${port} is now free`));
      } catch {
        console.log(chalk.red(`  ✗ Failed to kill PID ${blocker.pid}. Try: sudo kill ${blocker.pid}`));
        process.exit(1);
      }
    } else if (action === "alt" && altPort) {
      resolved[key] = altPort;
      console.log(chalk.green(`  ✓ Using port ${altPort} for ${labels[key]}`));
    } else {
      console.log(chalk.dim("  Init aborted."));
      process.exit(0);
    }
  }

  return resolved;
}

export async function launchVm(
  platform: PlatformInfo,
  diskPath: string,
  initIsoPath: string,
  ram: number,
  cpus: number,
  ports: ResolvedPorts,
): Promise<ResolvedPorts> {

  const machineArgs = platform.os === "mac"
    ? ["-machine", "virt,gic-version=3"]
    : ["-machine", "pc"];
  const biosArgs = fs.existsSync(platform.biosPath) ? ["-bios", platform.biosPath] : [];

  const buildArgs = (cpuArgs: string[]): string[] => [
    ...machineArgs,
    ...cpuArgs,
    "-m", `${ram}G`,
    "-smp", `${cpus}`,
    "-drive", `file=${diskPath},if=virtio,cache=writethrough`,
    "-drive", `file=${initIsoPath},if=virtio,format=raw,cache=writethrough`,
    "-display", "none",
    "-serial", "none",
    "-net", "nic,model=virtio",
    "-net", `user,hostfwd=tcp::${ports.ssh}-:22,hostfwd=tcp::${ports.http}-:4200,hostfwd=tcp::${ports.https}-:443`,
    ...biosArgs,
    "-pidfile", PID_FILE,
    "-daemonize",
  ];

  // Try with HVF acceleration first, fall back to software emulation
  try {
    await execa(platform.qemuBinary, buildArgs(platform.qemuCpuFlag.split(" ")), { env: scrubEnv() });
  } catch {
    const fallbackCpu = platform.os === "mac" ? ["-cpu", "max"] : ["-cpu", "qemu64"];
    await execa(platform.qemuBinary, buildArgs(fallbackCpu), { env: scrubEnv() });
  }
  return ports;
}

function readValidPid(): number | null {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = fs.readFileSync(PID_FILE, "utf-8").trim();
  const pid = parseInt(raw, 10);
  if (!Number.isInteger(pid) || pid <= 1 || pid > 4194304) return null;
  return pid;
}

function isQemuPid(pid: number): boolean {
  try {
    const { stdout } = execaSync("ps", ["-p", String(pid), "-o", "comm="], { env: scrubEnv() });
    return stdout.trim().toLowerCase().includes("qemu");
  } catch {
    return false;
  }
}

export function isVmRunning(): boolean {
  const pid = readValidPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopVm(): void {
  const pid = readValidPid();
  if (!pid) return;
  // Verify PID belongs to QEMU before signaling
  if (!isQemuPid(pid)) {
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already stopped
  }
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

export function getVmPid(): number | null {
  return readValidPid();
}
