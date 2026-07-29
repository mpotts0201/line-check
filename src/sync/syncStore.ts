// The sync engine's observable face. The engine WRITES here (it has no React
// hooks — it uses the store's plain setState/getState statics); screens READ
// here with the hook. Godot: an autoload singleton whose exported state the
// engine owns, and whose changes ARE the signals screens connect to.
import { create } from "zustand";

// Mirrors the engine's two modes. Lives here (not in syncEngine.ts) because
// the store is the single home of engine status.
export type SyncStatus = "idle" | "syncing";

type SyncStoreState = {
  status: SyncStatus;
  // How many flush attempts have ENDED (success or failure). This is the
  // sync_finished signal, shaped as a number so every emission is a change.
  flushCount: number;
};

export const useSyncStore = create<SyncStoreState>()(() => ({
  status: "idle",
  flushCount: 0,
}));
