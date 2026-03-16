import os from "node:os";

export interface PlatformInfo {
  os: "mac" | "linux" | "windows";
  arch: "arm64" | "x64";
  dockerPlatform: string;
}

export function detectPlatform(): PlatformInfo {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === "darwin") {
    return {
      os: "mac",
      arch: arch === "arm64" ? "arm64" : "x64",
      dockerPlatform: arch === "arm64" ? "linux/arm64" : "linux/amd64",
    };
  }

  if (platform === "linux") {
    return {
      os: "linux",
      arch: arch === "arm64" ? "arm64" : "x64",
      dockerPlatform: arch === "arm64" ? "linux/arm64" : "linux/amd64",
    };
  }

  if (platform === "win32") {
    return {
      os: "windows",
      arch: "x64",
      dockerPlatform: "linux/amd64",
    };
  }

  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}
