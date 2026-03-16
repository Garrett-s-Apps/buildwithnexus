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
    expect(info).toHaveProperty("dockerPlatform");
  });

  it("detects a known OS", () => {
    const info = detectPlatform();
    expect(["mac", "linux", "windows"]).toContain(info.os);
  });

  it("detects a known arch", () => {
    const info = detectPlatform();
    expect(["arm64", "x64"]).toContain(info.arch);
  });

  it("uses arm64 Docker platform on arm64", () => {
    const info = detectPlatform();
    if (os.arch() === "arm64") {
      expect(info.dockerPlatform).toBe("linux/arm64");
    }
  });

  it("uses amd64 Docker platform on x64 Linux", () => {
    const info = detectPlatform();
    if (os.platform() === "linux" && os.arch() === "x64") {
      expect(info.dockerPlatform).toBe("linux/amd64");
    }
  });
});
