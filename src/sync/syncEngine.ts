// Decides WHEN to sync. The actual pushing lives in flush.ts.
// One state machine, attached to the one actor in the app (like a Godot player).
// Pokes: the phone regaining signal, a screen calling syncNow() after completing
// an audit, and the manual Sync now button.

import NetInfo from "@react-native-community/netinfo";
import { type SqlDb } from "../db/types";
import { supabase } from "../supabase";
import { flushSyncQueue } from "./flush";

// The engine is always in exactly ONE of these modes.
type EngineStatus = "idle" | "syncing";

let db: SqlDb | null = null;   // written once at startup; why screens can call syncNow() bare
let isOnline = false;          // input from the phone — a fact, not a mode
let status: EngineStatus = "idle";

// Called once from the root layout. Watches connectivity; when the phone goes
// from offline to online, syncs. Returns a stop function for unmount.
export function startSyncEngine(database: SqlDb): () => void {
  db = database;
  // addEventListener does two things in ONE call: starts listening IMMEDIATELY,
  // and hands back the OFF switch. `unsubscribe` names what the stored function
  // does WHEN CALLED later — Godot: connect() that returns its own disconnect().
  const unsubscribe = NetInfo.addEventListener((state) => {
    // The phone's report is messy (fields can be null = "don't know").
    // Count as online only if definitely connected and not definitely unreachable.
    const nowOnline =
      state.isConnected === true && state.isInternetReachable !== false;
    const cameBackOnline = nowOnline && !isOnline; // offline → online edge, the ONLY trigger
    isOnline = nowOnline;
    if (cameBackOnline) void syncNow(); // "start this, don't wait around for it"
  });
  // The engine's own, bigger off switch: stop listening AND blank the sticky
  // notes. Handed up to the caller — the root layout stores it and presses it
  // at teardown.
  return () => {
    unsubscribe();
    status = "idle";
    isOnline = false;
    db = null;
  };
}

// Safe to call from anywhere, any time. Quietly does nothing when offline (the
// audit is already durable in SQLite; the reconnect trigger covers it later),
// when the engine isn't started, or when a push is already in flight.
export async function syncNow(): Promise<void> {
  if (!db || !isOnline || status === "syncing") return;

  status = "syncing";
  try {
    // On failure, flush.ts leaves the queue fully intact and surfaces the error;
    // the next poke (signal edge, Submit, manual button) simply tries again.
    // There is nothing to count and nothing to schedule.
    await flushSyncQueue(db, supabase);
  } finally {
    status = "idle"; // ALWAYS comes back down, even if the push throws
  }
}
