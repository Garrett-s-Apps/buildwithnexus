import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ENV_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"] as const;

function clearApiKeys() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

function saveApiKeys(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return saved;
}

function restoreApiKeys(saved: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
}

describe("loadApiKeys", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = saveApiKeys();
    clearApiKeys();
  });

  afterEach(() => {
    restoreApiKeys(saved);
  });

  it("returns all three keys when all are set", async () => {
    process.env.ANTHROPIC_API_KEY = "ant-key";
    process.env.OPENAI_API_KEY = "oai-key";
    process.env.GOOGLE_API_KEY = "goog-key";
    const { loadApiKeys } = await import("../src/core/config.js");
    const result = loadApiKeys();
    expect(result).toEqual({
      anthropic: "ant-key",
      openai: "oai-key",
      google: "goog-key",
    });
  });

  it("returns only anthropic when only ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "ant-key";
    const { loadApiKeys } = await import("../src/core/config.js");
    const result = loadApiKeys();
    expect(result.anthropic).toBe("ant-key");
    expect(result.openai).toBeUndefined();
    expect(result.google).toBeUndefined();
  });

  it("returns only google when only GOOGLE_API_KEY is set", async () => {
    process.env.GOOGLE_API_KEY = "goog-key";
    const { loadApiKeys } = await import("../src/core/config.js");
    const result = loadApiKeys();
    expect(result.google).toBe("goog-key");
    expect(result.anthropic).toBeUndefined();
    expect(result.openai).toBeUndefined();
  });

  it("returns all undefined when no keys are set", async () => {
    const { loadApiKeys } = await import("../src/core/config.js");
    const result = loadApiKeys();
    expect(result).toEqual({
      anthropic: undefined,
      openai: undefined,
      google: undefined,
    });
  });
});

describe("hasAnyKey", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = saveApiKeys();
    clearApiKeys();
  });

  afterEach(() => {
    restoreApiKeys(saved);
  });

  it("returns false when no keys are set", async () => {
    const { hasAnyKey } = await import("../src/core/config.js");
    expect(hasAnyKey()).toBe(false);
  });

  it("returns true when only ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "ant-key";
    const { hasAnyKey } = await import("../src/core/config.js");
    expect(hasAnyKey()).toBe(true);
  });

  it("returns true when only OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "oai-key";
    const { hasAnyKey } = await import("../src/core/config.js");
    expect(hasAnyKey()).toBe(true);
  });

  it("returns true when only GOOGLE_API_KEY is set", async () => {
    process.env.GOOGLE_API_KEY = "goog-key";
    const { hasAnyKey } = await import("../src/core/config.js");
    expect(hasAnyKey()).toBe(true);
  });

  it("returns true when all three keys are set", async () => {
    process.env.ANTHROPIC_API_KEY = "ant-key";
    process.env.OPENAI_API_KEY = "oai-key";
    process.env.GOOGLE_API_KEY = "goog-key";
    const { hasAnyKey } = await import("../src/core/config.js");
    expect(hasAnyKey()).toBe(true);
  });
});

describe("resolveApiKey", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = saveApiKeys();
    clearApiKeys();
  });

  afterEach(() => {
    restoreApiKeys(saved);
  });

  it("returns Anthropic key when all three are set (highest priority)", async () => {
    process.env.ANTHROPIC_API_KEY = "ant-key";
    process.env.OPENAI_API_KEY = "oai-key";
    process.env.GOOGLE_API_KEY = "goog-key";
    const { resolveApiKey } = await import("../src/core/config.js");
    expect(resolveApiKey()).toBe("ant-key");
  });

  it("returns Google key when only Google and OpenAI are set (Google over OpenAI)", async () => {
    process.env.OPENAI_API_KEY = "oai-key";
    process.env.GOOGLE_API_KEY = "goog-key";
    const { resolveApiKey } = await import("../src/core/config.js");
    expect(resolveApiKey()).toBe("goog-key");
  });

  it("returns OpenAI key when only OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "oai-key";
    const { resolveApiKey } = await import("../src/core/config.js");
    expect(resolveApiKey()).toBe("oai-key");
  });

  it("returns undefined when no keys are set", async () => {
    const { resolveApiKey } = await import("../src/core/config.js");
    expect(resolveApiKey()).toBeUndefined();
  });
});

describe("reloadEnv", () => {
  let tmpFile: string;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = saveApiKeys();
    clearApiKeys();
    tmpFile = path.join(os.tmpdir(), `config-test-${Date.now()}.env`);
  });

  afterEach(() => {
    restoreApiKeys(saved);
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  it("loads keys from a temp .env file into process.env", async () => {
    fs.writeFileSync(tmpFile, "ANTHROPIC_API_KEY=from-file\n");
    const { reloadEnv } = await import("../src/core/config.js");
    reloadEnv(tmpFile);
    expect(process.env.ANTHROPIC_API_KEY).toBe("from-file");
  });

  it("overrides existing env vars with values from the file (override: true)", async () => {
    process.env.ANTHROPIC_API_KEY = "original-value";
    fs.writeFileSync(tmpFile, "ANTHROPIC_API_KEY=overridden-value\n");
    const { reloadEnv } = await import("../src/core/config.js");
    reloadEnv(tmpFile);
    expect(process.env.ANTHROPIC_API_KEY).toBe("overridden-value");
  });
});
