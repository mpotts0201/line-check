export type AutoSync = {
  onConnectivityChange(isConnected: boolean): Promise<void>;
  requestFlush(): Promise<void>;
};

// The sync coordinator: owns the two live triggers and the single-flight guard.
//
// Trigger 1 — edge-triggered auto-sync. Flushes once when connectivity RETURNS (a
// false→true transition); never on a steady 'connected' event. Initial state is
// 'disconnected' so the first confirmed connection (including the event NetInfo fires on
// subscribe) drains any queue left over from a previous offline session.
//
// Trigger 2 — requestFlush, for "an audit was just completed" (8b-ii.5). Does nothing when
// offline, ON PURPOSE: trying with no signal would burn the retry chances (attempts climbs
// on every failure, gives up at 3) while the phone sits in a dead zone, and the audit would
// reach reconnection already given up. By not trying at all, attempts stay at 0 and
// trigger 1 still drains the queue later with every chance intact.
//
// Both triggers share runFlush, so there is never more than one flush in flight.
// Pure and injectable: takes only a `flush` thunk and imports neither NetInfo nor the
// supabase singleton, so it's unit-testable and the app root composes the real wiring.
export function createAutoSync(deps: { flush: () => Promise<unknown> }): AutoSync {
  let wasConnected = false;
  let flushing = false;

  async function runFlush(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      await deps.flush();
    } finally {
      flushing = false;
    }
  }

  return {
    async onConnectivityChange(isConnected) {
      const regained = isConnected && !wasConnected;
      wasConnected = isConnected;
      if (!regained) return;
      await runFlush();
    },

    async requestFlush() {
      if (!wasConnected) return;
      await runFlush();
    },
  };
}
