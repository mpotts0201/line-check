export type AutoSync = { onConnectivityChange(isConnected: boolean): Promise<void> };

// Edge-triggered auto-sync. Flushes once when connectivity RETURNS (a false→true transition);
// never on a steady 'connected' event, and never concurrently (the in-flight guard drops a
// re-entrant trigger while a flush is running). Pure and injectable: it takes only a `flush`
// thunk and imports neither NetInfo nor the supabase singleton, so it's unit-testable and the
// app root composes `flush: () => flushSyncQueue(db, supabase)`. Initial state is
// 'disconnected' so the first confirmed connection (including the event NetInfo fires on
// subscribe) drains any queue left over from a previous offline session.
export function createAutoSync(deps: { flush: () => Promise<unknown> }): AutoSync {
  let wasConnected = false;
  let flushing = false;

  return {
    async onConnectivityChange(isConnected) {
      const regained = isConnected && !wasConnected;
      wasConnected = isConnected;
      if (!regained || flushing) return;

      flushing = true;
      try {
        await deps.flush();
      } finally {
        flushing = false;
      }
    },
  };
}
