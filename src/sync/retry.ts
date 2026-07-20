import { type FlushResult } from "./flush";

// Give up after this many failed attempts per queue row — auto-sync stops retrying a stuck
// row so a permanently-failing audit doesn't burn battery/network forever. (8b surfaces a
// per-audit manual "Retry sync" that resets attempts.) With the delay doubling each try, 3
// attempts already spans a sensible window.
export const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;

// Wait before the next retry after `attempts` failures (1-based: 1 after the first failure).
// Doubles per attempt, capped. Pure — unit-tested for growth + cap.
export function backoffDelay(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
}

// One flush entry point. An in-flight guard funnels every trigger (connectivity regain + timed
// backoff retries) through a single at-a-time gate; on a failure still under the give-up
// threshold it reschedules itself after backoffDelay, so the loop self-sustains until the queue
// drains (success) or the rows give up. `schedule` is injected — setTimeout in production, a
// controllable fake in tests — so the retry loop is unit-testable without real timers.
export function createSyncScheduler(deps: {
  flush: () => Promise<FlushResult>;
  schedule: (fn: () => void, delayMs: number) => void;
}): { trigger: () => Promise<void> } {
  let running = false;

  async function trigger(): Promise<void> {
    if (running) return;
    running = true;
    let result: FlushResult;
    try {
      result = await deps.flush();
    } finally {
      running = false;
    }
    if (result.status === "error" && result.attempts < MAX_ATTEMPTS) {
      deps.schedule(trigger, backoffDelay(result.attempts));
    }
  }

  return { trigger };
}
