import { createAutoSync } from "./autoSync";

describe("createAutoSync", () => {
  it("flushes once when connectivity is regained (false→true edge)", async () => {
    let calls = 0;
    const auto = createAutoSync({ flush: async () => void calls++ });

    await auto.onConnectivityChange(true);

    expect(calls).toBe(1);
  });

  it("does not flush on a steady 'connected' event (no edge)", async () => {
    let calls = 0;
    const auto = createAutoSync({ flush: async () => void calls++ });

    await auto.onConnectivityChange(true); // regain → 1
    await auto.onConnectivityChange(true); // still connected, no edge → still 1

    expect(calls).toBe(1);
  });

  it("does not flush while offline", async () => {
    let calls = 0;
    const auto = createAutoSync({ flush: async () => void calls++ });

    await auto.onConnectivityChange(false);

    expect(calls).toBe(0);
  });

  it("does not double-flush when triggers overlap (in-flight guard)", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const auto = createAutoSync({
      flush: async () => {
        calls++;
        await gate;
      },
    });

    const first = auto.onConnectivityChange(true); // starts flush, awaits the gate
    await auto.onConnectivityChange(false); // disconnect (no flush)
    const second = auto.onConnectivityChange(true); // regain while flushing → guarded
    release();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
  });

  it("flushes again on a later regain once the guard is released", async () => {
    let calls = 0;
    const auto = createAutoSync({ flush: async () => void calls++ });

    await auto.onConnectivityChange(true); // 1
    await auto.onConnectivityChange(false);
    await auto.onConnectivityChange(true); // 2

    expect(calls).toBe(2);
  });
});
