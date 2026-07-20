import { type FlushResult } from "./flush";
import { MAX_ATTEMPTS, backoffDelay, createSyncScheduler } from "./retry";

describe("backoffDelay", () => {
  it("grows with each attempt", () => {
    expect(backoffDelay(2)).toBeGreaterThan(backoffDelay(1));
    expect(backoffDelay(3)).toBeGreaterThan(backoffDelay(2));
  });

  it("caps so the delay can't grow without bound", () => {
    expect(backoffDelay(50)).toBe(backoffDelay(100)); // both pinned at the cap
  });
});

describe("createSyncScheduler", () => {
  it("reschedules once with backoffDelay after a failure under the give-up limit", async () => {
    const flush = async (): Promise<FlushResult> => ({ status: "error", error: "x", attempts: 1 });
    const scheduled: { fn: () => void; delay: number }[] = [];
    const sched = createSyncScheduler({
      flush,
      schedule: (fn, delay) => scheduled.push({ fn, delay }),
    });

    await sched.trigger();

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].delay).toBe(backoffDelay(1));
  });

  it("does not reschedule after a successful flush", async () => {
    const flush = async (): Promise<FlushResult> => ({ status: "synced", audits: 1, items: 2 });
    const scheduled: number[] = [];
    const sched = createSyncScheduler({ flush, schedule: (_fn, delay) => scheduled.push(delay) });

    await sched.trigger();

    expect(scheduled).toEqual([]);
  });

  it("does not reschedule at the give-up threshold", async () => {
    const flush = async (): Promise<FlushResult> => ({
      status: "error",
      error: "x",
      attempts: MAX_ATTEMPTS,
    });
    const scheduled: number[] = [];
    const sched = createSyncScheduler({ flush, schedule: (_fn, delay) => scheduled.push(delay) });

    await sched.trigger();

    expect(scheduled).toEqual([]); // gave up — no further retries
  });

  it("does not run concurrent flushes (in-flight guard)", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const flush = async (): Promise<FlushResult> => {
      calls++;
      await gate;
      return { status: "synced", audits: 0, items: 0 };
    };
    const sched = createSyncScheduler({ flush, schedule: () => {} });

    const first = sched.trigger(); // running, awaits the gate
    const second = sched.trigger(); // guarded → no-op
    release();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
  });

  it("retries with growing backoff until a later success drains the queue", async () => {
    const results: FlushResult[] = [
      { status: "error", error: "x", attempts: 1 },
      { status: "error", error: "x", attempts: 2 },
      { status: "synced", audits: 1, items: 2 },
    ];
    let calls = 0;
    const flush = async (): Promise<FlushResult> => results[calls++];

    const delays: number[] = [];
    const tasks: Array<() => Promise<void>> = [];
    const sched = createSyncScheduler({
      flush,
      // Record the delay and defer the retry into a queue we drain manually — deterministic,
      // no real timers.
      schedule: (fn, delay) => {
        delays.push(delay);
        tasks.push(fn as () => Promise<void>);
      },
    });

    await sched.trigger();
    while (tasks.length > 0) await tasks.shift()!();

    expect(calls).toBe(3); // fail, fail, then succeed
    expect(delays).toEqual([backoffDelay(1), backoffDelay(2)]);
  });
});
