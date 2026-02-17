import os from "node:os";

export interface PlatformInfo {
  os: "mac" | "linux" | "windows";
  arch: "arm64" | "x64";
  qemuBinary: string;
  qemuCpuFlag: string;
  ubuntuImage: string;
  biosPath: string;
}

export function detectPlatform(): PlatformInfo {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === "darwin") {
    return {
      os: "mac",
      arch: arch === "arm64" ? "arm64" : "x64",
      qemuBinary: "qemu-system-aarch64",
      qemuCpuFlag: "-cpu host",
      ubuntuImage: "jammy-server-cloudimg-arm64.img",
      biosPath: "/opt/homebrew/share/qemu/edk2-aarch64-code.fd",
    };
  }

  if (platform === "linux") {
    return {
      os: "linux",
      arch: arch === "arm64" ? "arm64" : "x64",
      qemuBinary: arch === "arm64" ? "qemu-system-aarch64" : "qemu-system-x86_64",
      qemuCpuFlag: "-cpu host -enable-kvm",
      ubuntuImage: arch === "arm64" ? "jammy-server-cloudimg-arm64.img" : "jammy-server-cloudimg-amd64.img",
      biosPath: arch === "arm64" ? "/usr/share/qemu-efi-aarch64/QEMU_EFI.fd" : "/usr/share/OVMF/OVMF_CODE.fd",
    };
  }

  if (platform === "win32") {
    return {
      os: "windows",
      arch: "x64",
      qemuBinary: "qemu-system-x86_64",
      qemuCpuFlag: "-cpu qemu64",
      ubuntuImage: "jammy-server-cloudimg-amd64.img",
      biosPath: "C:\\Program Files\\qemu\\share\\edk2-x86_64-code.fd",
    };
  }

  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}
