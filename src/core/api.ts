// src/core/api.ts — shared HTTP helpers for backend communication
import { loadApiKeys, type ApiKeys } from "./config.js";

// ═══════════════════════════════════════════════════════════════════
// 1. RUN PAYLOAD BUILDER
// ═══════════════════════════════════════════════════════════════════

export interface RunPayload {
  task: string;
  agent_role: string;
  agent_goal: string;
  api_key: string;
  openai_api_key: string;
  google_api_key: string;
}

/**
 * Build the standard payload for POST /api/run.
 * Loads API keys from the environment and maps them into the
 * shape the backend expects.
 */
export function buildRunPayload(
  task: string,
  agentRole: string,
  agentGoal: string,
  keys?: ApiKeys,
): RunPayload {
  const k = keys ?? loadApiKeys();
  return {
    task,
    agent_role: agentRole,
    agent_goal: agentGoal,
    api_key: k.anthropic || "",
    openai_api_key: k.openai || "",
    google_api_key: k.google || "",
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. HTTP HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * POST JSON to a local NEXUS endpoint.
 * Returns the parsed `response` / `message` field, or the raw text.
 * Throws on non-OK status.
 */
export async function httpPost(
  httpPort: number,
  path: string,
  body: unknown,
  timeoutMs: number = 60_000,
): Promise<string> {
  const res = await fetch(`http://localhost:${httpPort}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return parsed.response ?? parsed.message ?? text;
  } catch {
    return text;
  }
}

/**
 * GET a local NEXUS endpoint with a timeout.
 * Never throws — returns `{ ok: false, text: "" }` on any failure.
 */
export async function httpGet(
  httpPort: number,
  path: string,
  timeoutMs: number = 10_000,
): Promise<{ ok: boolean; text: string }> {
  try {
    const res = await fetch(`http://localhost:${httpPort}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return { ok: res.ok, text };
  } catch {
    return { ok: false, text: "" };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 3. HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════

/**
 * Check whether the backend is reachable and healthy.
 *
 * Accepts either a full URL (e.g. `http://localhost:4200`) or a port
 * number.  Returns true when the response is OK.
 *
 * NOT used by ninety-nine.ts or init.ts which have specialised
 * timeout / backoff logic.
 */
export async function checkServerHealth(
  target: string | number,
  timeoutMs: number = 10_000,
): Promise<boolean> {
  const url =
    typeof target === "number"
      ? `http://localhost:${target}/health`
      : `${target}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}
