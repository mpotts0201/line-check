// Tests for the sync engine — the one state machine deciding WHEN to sync.
//
// First use of jest.mock in this repo, on purpose (REFACTOR_PROPOSAL §7): the
// engine imports its collaborators directly — no DI seams in production code —
// so the test swaps the MODULES themselves. flush.ts becomes a stunt double,
// NetInfo's addEventListener is captured so tests can feed it fake reports, and
// the supabase module is stubbed because its real top-level createClient() would
// run here without env vars and throw.
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { type SqlDb } from "../db/types";
import { flushSyncQueue } from "./flush";
import { startSyncEngine, syncNow } from "./syncEngine";

jest.mock("./flush");
jest.mock("../supabase", () => ({ supabase: {} }));
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true, // syncEngine uses `import NetInfo from ...` (a default import)
  default: { addEventListener: jest.fn(() => jest.fn()) }, // hands back a fake unsubscribe
}));

const mockFlush = flushSyncQueue as jest.MockedFunction<typeof flushSyncQueue>;
const mockAddEventListener = NetInfo.addEventListener as jest.Mock;

// The engine reads exactly two fields off a report; the rest of the real
// NetInfoState (type, details, ...) is irrelevant to it, so fakes carry only
// what the collapse logic looks at.
function report(
  isConnected: boolean | null,
  isInternetReachable: boolean | null
): NetInfoState {
  return { isConnected, isInternetReachable } as unknown as NetInfoState;
}

// The engine settles back to idle a few microtask beats after the fake push
// resolves (await chain: flush result → try block → finally). Generous on
// purpose — three beats cover any chain depth here without timing games.
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("syncEngine", () => {
  let stop: () => void;
  let listener: (state: NetInfoState) => void;

  beforeEach(() => {
    // Fresh engine per test — its state lives in module vars (db/isOnline/
    // status) that would otherwise leak between tests. The engine never touches
    // the db handle itself (it only passes it to the mocked flush), so an empty
    // object suffices.
    stop = startSyncEngine({} as SqlDb);
    listener = mockAddEventListener.mock.calls[0][0] as typeof listener;
  });

  afterEach(() => {
    stop(); // blanks the module vars so the next test starts cold
    jest.clearAllMocks();
  });

  it("syncs exactly once when connectivity is regained (offline→online edge)", () => {
    listener(report(false, false));
    listener(report(true, true));

    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it("does not re-sync on steady 'still online' reports (no edge)", () => {
    listener(report(true, true)); // cold start counts as offline, so this IS an edge
    listener(report(true, true));
    listener(report(true, true));

    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it("never syncs on offline reports, including don't-know fields", () => {
    listener(report(false, false));
    listener(report(null, null)); // "don't know" counts as offline
    listener(report(true, false)); // connected to wifi, but internet unreachable

    expect(mockFlush).not.toHaveBeenCalled();
  });

  it("syncNow() while offline does nothing — the audit is already safe in SQLite", async () => {
    await syncNow(); // isOnline is false from cold start

    expect(mockFlush).not.toHaveBeenCalled();
  });

  it("does not double-run while a push is in flight (single-flight guard)", async () => {
    listener(report(true, true)); // get the engine online; this edge sync is setup noise
    await settle();
    mockFlush.mockClear();

    // Hold the next push open so a second poke arrives mid-flight. `Once` so
    // the gate doesn't outlive this test — clearAllMocks clears calls, not
    // implementations. The post-release poke below falls back to the automock.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockFlush.mockImplementationOnce(async () => {
      await gate;
      return { status: "empty" };
    });

    const inFlight = syncNow(); // push starts; the engine is now `syncing`
    await syncNow(); // second poke → guard returns immediately, no second push

    expect(mockFlush).toHaveBeenCalledTimes(1);

    // Let the push finish. Awaiting the engine's own promise guarantees its
    // finally block (status → idle) has run — then prove the flag came down.
    release();
    await inFlight;
    await syncNow();

    expect(mockFlush).toHaveBeenCalledTimes(2);
  });

  it("after cleanup, pokes do nothing", async () => {
    const unsubscribe = mockAddEventListener.mock.results[0].value as jest.Mock;
    stop();

    listener(report(true, true)); // a stale report from the already-dead listener
    await syncNow();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockFlush).not.toHaveBeenCalled();
  });
});
