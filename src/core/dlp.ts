// Data Loss Prevention — OOTB security controls for buildwithnexus
// Active by default, zero configuration, no new dependencies

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Compute locally to avoid circular dependency with secrets.ts
const NEXUS_HOME = path.join(process.env.HOME || "~", ".buildwithnexus");

// ═══════════════════════════════════════════════════════════════════
// 1. SECRET PATTERNS — regex patterns for all known key formats
// ═══════════════════════════════════════════════════════════════════

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-api03-[A-Za-z0-9_-]{20,}/g,   // Anthropic API key
  /sk-[A-Za-z0-9]{20,}/g,                // OpenAI API key
  /AIza[A-Za-z0-9_-]{35}/g,              // Google AI API key
];

// Characters that MUST NOT appear in any key value (injection vectors)
const FORBIDDEN_KEY_CHARS = /[\n\r\t'"\\`${}();&|<>!#%^]/;

// Format validators per key type
const KEY_VALIDATORS: Record<string, RegExp> = {
  ANTHROPIC_API_KEY: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  OPENAI_API_KEY: /^sk-[A-Za-z0-9_-]{20,}$/,
  GOOGLE_API_KEY: /^AIza[A-Za-z0-9_-]{35,}$/,
  NEXUS_MASTER_SECRET: /^[A-Za-z0-9_-]{20,64}$/,
};

// ═══════════════════════════════════════════════════════════════════
// 2. INPUT SANITIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Escape a value for safe embedding in a YAML scalar position.
 * Prevents YAML injection via multiline or special characters.
 */
export function yamlEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\0/g, "");
}

/**
 * Escape a value for safe use inside single-quoted shell arguments.
 * Uses the standard '...' + \' + '...' idiom.
 */
export function shellEscape(value: string): string {
  if (value.includes("\0")) {
    throw new DlpViolation("Null byte in shell argument");
  }
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Tagged template for building shell commands with escaped interpolations.
 * String parts are trusted; expressions are shell-escaped.
 *
 * Usage: shellCommand`printf '%s\n' ${url} > /tmp/file.txt`
 */
export function shellCommand(
  strings: TemplateStringsArray,
  ...values: string[]
): string {
  let result = strings[0];
  for (let i = 0; i < values.length; i++) {
    result += shellEscape(values[i]) + strings[i + 1];
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// 3. OUTPUT REDACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Redact any recognized secret patterns from a string.
 * Safe to call on any output — logs, errors, stdout, stderr.
 */
export function redact(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Redact secrets from an Error's message and stack.
 * Returns a new Error — never mutates the original.
 */
export function redactError(err: unknown): Error {
  if (err instanceof Error) {
    const safe = new Error(redact(err.message));
    safe.name = err.name;
    if (err.stack) safe.stack = redact(err.stack);
    return safe;
  }
  return new Error(redact(String(err)));
}

// ═══════════════════════════════════════════════════════════════════
// 4. SECRET VALIDATION
// ═══════════════════════════════════════════════════════════════════

/** Custom error class for DLP violations — never includes secret material */
export class DlpViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DlpViolation";
  }
}

/**
 * Validate that a key value matches expected format and contains no
 * injection characters. Call at input boundaries (prompt, keys set).
 * Throws DlpViolation with a safe message (never includes the key value).
 */
export function validateKeyValue(keyName: string, value: string): void {
  if (FORBIDDEN_KEY_CHARS.test(value)) {
    throw new DlpViolation(
      `${keyName} contains characters that are not permitted in API keys`,
    );
  }

  if (value.length < 10 || value.length > 256) {
    throw new DlpViolation(
      `${keyName} length out of expected range (10-256 characters)`,
    );
  }

  const validator = KEY_VALIDATORS[keyName];
  if (validator && !validator.test(value)) {
    throw new DlpViolation(
      `${keyName} does not match the expected format for this key type`,
    );
  }
}

/**
 * Validate all keys in a record. Returns array of violation messages
 * (empty if all valid).
 */
export function validateAllKeys(
  keys: Record<string, string | undefined>,
): string[] {
  const violations: string[] = [];
  for (const [name, value] of Object.entries(keys)) {
    if (!value) continue;
    try {
      validateKeyValue(name, value);
    } catch (err) {
      if (err instanceof DlpViolation) violations.push(err.message);
    }
  }
  return violations;
}

// ═══════════════════════════════════════════════════════════════════
// 5. FILE INTEGRITY (HMAC)
// ═══════════════════════════════════════════════════════════════════

const HMAC_PATH = path.join(NEXUS_HOME, ".keys.hmac");

function computeFileHmac(filePath: string, secret: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHmac("sha256", secret).update(content).digest("hex");
}

/** Write HMAC seal for .env.keys. Call after every saveKeys(). */
export function sealKeysFile(keysPath: string, masterSecret: string): void {
  const hmac = computeFileHmac(keysPath, masterSecret);
  fs.writeFileSync(HMAC_PATH, hmac, { mode: 0o600 });
}

/**
 * Verify HMAC seal of .env.keys. Returns true if valid or if neither
 * file exists yet (genuine first run). Returns false if tampered or
 * if keys exist without a seal (seal was deleted).
 */
export function verifyKeysFile(keysPath: string, masterSecret: string): boolean {
  const keysExist = fs.existsSync(keysPath);
  const hmacExist = fs.existsSync(HMAC_PATH);
  if (!keysExist && !hmacExist) return true;
  if (keysExist && !hmacExist) return false;
  try {
    const stored = fs.readFileSync(HMAC_PATH, "utf-8").trim();
    const computed = computeFileHmac(keysPath, masterSecret);
    return crypto.timingSafeEqual(
      Buffer.from(stored, "hex"),
      Buffer.from(computed, "hex"),
    );
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 6. AUDIT TRAIL
// ═══════════════════════════════════════════════════════════════════

const AUDIT_PATH = path.join(NEXUS_HOME, "audit.log");
const MAX_AUDIT_SIZE = 10 * 1024 * 1024; // 10MB

export type AuditEvent =
  | "keys_saved"
  | "keys_loaded"
  | "keys_validated"
  | "keys_tampered"
  | "cloudinit_rendered"
  | "cloudinit_iso_created"
  | "cloudinit_plaintext_deleted"
  | "ssh_exec"
  | "tunnel_url_captured"
  | "dlp_violation"
  | "env_scrubbed";

/**
 * Append structured audit entry. Never include secret values.
 * Format: ISO8601 | EVENT | detail
 * Auto-rotates at 10MB. Never throws.
 */
export function audit(event: AuditEvent, detail: string = ""): void {
  try {
    const dir = path.dirname(AUDIT_PATH);
    if (!fs.existsSync(dir)) return;

    if (fs.existsSync(AUDIT_PATH)) {
      const stat = fs.statSync(AUDIT_PATH);
      if (stat.size > MAX_AUDIT_SIZE) {
        const rotated = AUDIT_PATH + ".1";
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(AUDIT_PATH, rotated);
        try { fs.chmodSync(rotated, 0o600); } catch { /* best-effort */ }
      }
    }

    const line = `${new Date().toISOString()} | ${event} | ${redact(detail)}\n`;
    fs.appendFileSync(AUDIT_PATH, line, { mode: 0o600 });
    try { fs.chmodSync(AUDIT_PATH, 0o600); } catch { /* best-effort */ }
  } catch {
    // Audit must never throw and break the CLI
  }
}

// ═══════════════════════════════════════════════════════════════════
// 7. ENVIRONMENT SCRUBBING
// ═══════════════════════════════════════════════════════════════════

const SCRUB_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "NEXUS_MASTER_SECRET",
  "NEXUS_SECRET",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
  "DOCKER_PASSWORD",
  "CI_JOB_TOKEN",
];

/**
 * Return a copy of process.env with all known secret keys removed
 * and any env var whose value matches secret patterns scrubbed.
 * Pass to execa's env option for child processes.
 */
export function scrubEnv(): NodeJS.ProcessEnv {
  const clean = { ...process.env };
  for (const key of SCRUB_KEYS) {
    delete clean[key];
  }
  for (const [key, value] of Object.entries(clean)) {
    if (value) {
      for (const pattern of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(value)) {
          delete clean[key];
          break;
        }
      }
    }
  }
  return clean;
}

// ═══════════════════════════════════════════════════════════════════
// 8. MEMORY SAFETY
// ═══════════════════════════════════════════════════════════════════

/** Overwrite a Buffer's contents with zeros. */
export function zeroBuffer(buf: Buffer): Buffer {
  buf.fill(0);
  return buf;
}
