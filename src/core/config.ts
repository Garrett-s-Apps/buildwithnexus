import dotenv from "dotenv";
import path from "node:path";
import os from "node:os";

/** Shape of the API keys object returned by loadApiKeys(). */
export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
}

/**
 * Reads API keys from environment variables.
 * Returns an object with undefined for any keys that are not set.
 * Logs a warning for keys that are set but empty or whitespace-only.
 */
export function loadApiKeys(): ApiKeys {
  const keyNames: Array<[string, keyof ApiKeys]> = [
    ['ANTHROPIC_API_KEY', 'anthropic'],
    ['OPENAI_API_KEY', 'openai'],
    ['GOOGLE_API_KEY', 'google'],
  ];

  const result: ApiKeys = {};

  for (const [envName, key] of keyNames) {
    const raw = process.env[envName];
    if (raw !== undefined) {
      if (raw.trim() === '') {
        console.warn(`WARNING: ${envName} is set but empty - it will be treated as unconfigured`);
        result[key] = undefined;
      } else {
        result[key] = raw;
      }
    } else {
      result[key] = undefined;
    }
  }

  return result;
}

/**
 * Returns the first available API key in priority order:
 * Anthropic > Google > OpenAI.
 * Returns undefined if none are configured.
 */
export function resolveApiKey(): string | undefined {
  return (
    process.env.ANTHROPIC_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    undefined
  );
}

/**
 * Returns true if at least one of the three API keys is set and non-empty.
 */
export function hasAnyKey(): boolean {
  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_API_KEY
  );
}

/**
 * Validates that a backend URL is safe for transmitting API keys.
 * - localhost / 127.0.0.1 are allowed over HTTP (development).
 * - All other hosts require HTTPS.
 */
export function validateBackendUrl(url: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: `Invalid backend URL: ${url}` };
  }

  const hostname = parsed.hostname;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";

  if (parsed.protocol === "https:") {
    return { valid: true };
  }

  if (isLocal) {
    return { valid: true };
  }

  return {
    valid: false,
    error:
      "WARNING: Backend URL is not localhost and not HTTPS. " +
      "API keys will be transmitted in plaintext. " +
      "Use SSH tunnel or HTTPS endpoint.",
  };
}

/**
 * Reloads environment variables from a .env file into process.env.
 * Defaults to ~/.env.local. Uses override: true so new values take effect
 * immediately without restarting the CLI.
 */
export function reloadEnv(envPath?: string): void {
  const resolvedPath = envPath ?? path.join(os.homedir(), ".env.local");
  dotenv.config({ path: resolvedPath, override: true });
}
