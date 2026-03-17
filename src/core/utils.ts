/**
 * Exponential backoff: 3 s → 6 s → 12 s → … capped at 30 s.
 */
export function backoffMs(attempt: number): number {
  return Math.min(3000 * Math.pow(2, attempt), 30_000);
}
