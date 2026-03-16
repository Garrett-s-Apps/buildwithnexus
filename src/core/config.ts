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
 */
export function loadApiKeys(): ApiKeys {
  return {
    anthropic: process.env.ANTHROPIC_API_KEY || undefined,
    openai: process.env.OPENAI_API_KEY || undefined,
    google: process.env.GOOGLE_API_KEY || undefined,
  };
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
 * Reloads environment variables from a .env file into process.env.
 * Defaults to ~/.env.local. Uses override: true so new values take effect
 * immediately without restarting the CLI.
 */
export function reloadEnv(envPath?: string): void {
  const resolvedPath = envPath ?? path.join(os.homedir(), ".env.local");
  dotenv.config({ path: resolvedPath, override: true });
}
