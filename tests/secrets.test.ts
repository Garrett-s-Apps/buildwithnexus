import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We test the pure functions that don't depend on NEXUS_HOME at import time
// For secrets module, we test maskKey and the config/keys round-trip logic

describe("maskKey", () => {
  it("masks keys longer than 8 characters with proportional reveal", async () => {
    const { maskKey } = await import("../src/core/secrets.js");
    const result = maskKey("sk-ant-api03-abcdefghijk"); // 23 chars → reveal=2
    expect(result).toBe("sk...jk");
    expect(result).not.toContain("api03");
  });

  it("returns *** for short keys", async () => {
    const { maskKey } = await import("../src/core/secrets.js");
    expect(maskKey("short")).toBe("***");
    expect(maskKey("12345678")).toBe("***");
  });

  it("reveals at most 10% of key length per side", async () => {
    const { maskKey } = await import("../src/core/secrets.js");
    // 16 chars → reveal = floor(1.6) = 1
    const result = maskKey("abcdefghijklmnop");
    expect(result).toBe("a...p");
    // 80 chars → reveal = min(4, 8) = 4
    const longKey = "a".repeat(80);
    const longResult = maskKey(longKey);
    expect(longResult).toBe("aaaa...aaaa");
  });
});

describe("generateMasterSecret", () => {
  let generateMasterSecret: () => string;

  beforeEach(async () => {
    const mod = await import("../src/core/secrets.js");
    generateMasterSecret = mod.generateMasterSecret;
  });

  it("generates a base64url string", () => {
    const secret = generateMasterSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique values", () => {
    const a = generateMasterSecret();
    const b = generateMasterSecret();
    expect(a).not.toBe(b);
  });

  it("generates sufficient length (32 bytes = ~43 chars base64url)", () => {
    const secret = generateMasterSecret();
    expect(secret.length).toBeGreaterThanOrEqual(40);
  });
});
