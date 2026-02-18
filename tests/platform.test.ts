import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";

describe("detectPlatform", () => {
  let detectPlatform: () => import("../src/core/platform.js").PlatformInfo;

  beforeEach(async () => {
    const mod = await import("../src/core/platform.js");
    detectPlatform = mod.detectPlatform;
  });

  it("returns a valid PlatformInfo object", () => {
    const info = detectPlatform();
    expect(info).toHaveProperty("os");
    expect(info).toHaveProperty("arch");
    expect(info).toHaveProperty("qemuBinary");
    expect(info).toHaveProperty("qemuCpuFlag");
    expect(info).toHaveProperty("ubuntuImage");
    expect(info).toHaveProperty("biosPath");
  });

  it("detects a known OS", () => {
    const info = detectPlatform();
    expect(["mac", "linux", "windows"]).toContain(info.os);
  });

  it("detects a known arch", () => {
    const info = detectPlatform();
    expect(["arm64", "x64"]).toContain(info.arch);
  });

  it("has a valid qemuBinary", () => {
    const info = detectPlatform();
    expect(info.qemuBinary).toMatch(/^qemu-system-(aarch64|x86_64)$/);
  });

  it("uses arm64 Ubuntu image on arm64", () => {
    const info = detectPlatform();
    if (os.arch() === "arm64") {
      expect(info.ubuntuImage).toContain("arm64");
    }
  });

  it("uses amd64 Ubuntu image on x64 Linux", () => {
    const info = detectPlatform();
    if (os.platform() === "linux" && os.arch() === "x64") {
      expect(info.ubuntuImage).toContain("amd64");
    }
  });
});
