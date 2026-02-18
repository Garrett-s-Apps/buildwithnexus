import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
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
    try {
      await execa("sudo", ["apt-get", "update"], { stdio: "inherit", env: scrubEnv() });
      await execa("sudo", ["apt-get", "install", "-y", "qemu-system", "qemu-utils", "genisoimage"], { stdio: "inherit", env: scrubEnv() });
    } catch {
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
  await execa("curl", ["-L", "-o", imagePath, "--progress-bar", url], { stdio: "inherit", env: scrubEnv() });
  return imagePath;
}

export async function createDisk(basePath: string, sizeGb: number): Promise<string> {
  const diskPath = path.join(IMAGES_DIR, "nexus-vm-disk.qcow2");
  if (fs.existsSync(diskPath)) return diskPath;

  await execa("qemu-img", ["create", "-f", "qcow2", "-b", basePath, "-F", "qcow2", diskPath, `${sizeGb}G`], { env: scrubEnv() });
  return diskPath;
}

export async function launchVm(
  platform: PlatformInfo,
  diskPath: string,
  initIsoPath: string,
  ram: number,
  cpus: number,
  ports: { ssh: number; http: number; https: number },
): Promise<void> {
  const machineArg = platform.os === "mac" ? "-machine virt,gic-version=3" : "-machine pc";
  const biosArgs = fs.existsSync(platform.biosPath) ? ["-bios", platform.biosPath] : [];

  const args = [
    ...machineArg.split(" "),
    ...platform.qemuCpuFlag.split(" "),
    "-m", `${ram}G`,
    "-smp", `${cpus}`,
    "-drive", `file=${diskPath},if=virtio,cache=writethrough`,
    "-drive", `file=${initIsoPath},if=virtio,cache=writethrough`,
    "-display", "none",
    "-serial", "none",
    "-net", "nic,model=virtio",
    "-net", `user,hostfwd=tcp::${ports.ssh}-:22,hostfwd=tcp::${ports.http}-:4200,hostfwd=tcp::${ports.https}-:443`,
    ...biosArgs,
    "-pidfile", PID_FILE,
    "-daemonize",
  ];

  await execa(platform.qemuBinary, args, { env: scrubEnv() });
}

function readValidPid(): number | null {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = fs.readFileSync(PID_FILE, "utf-8").trim();
  const pid = parseInt(raw, 10);
  if (!Number.isInteger(pid) || pid <= 1 || pid > 4194304) return null;
  return pid;
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
