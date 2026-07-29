import { formatSyncError } from "./formatSyncError";

// Tier-1 logic tests: pure function, no mocks, no db. One case per branch —
// the ordering rules (Error before object-shape) and the fallbacks (JSON,
// then String on circular) are exactly what a component test couldn't pin.

describe("formatSyncError", () => {
  it("returns an Error's message", () => {
    expect(formatSyncError(new Error("network request failed"))).toBe(
      "network request failed"
    );
  });

  it("falls through an empty-message Error to the object branch (JSON)", () => {
    // An Error with no message has nothing to say via `.message`; the object
    // branch serializes it instead of returning an empty string.
    const result = formatSyncError(new Error(""));
    expect(result).not.toBe("");
    expect(result).toBe(JSON.stringify(new Error("")));
  });

  it("joins all four Postgrest fields with a separator", () => {
    const postgrest = {
      code: "23505",
      message: "duplicate key value",
      details: "Key (id) already exists.",
      hint: "Use upsert.",
    };
    expect(formatSyncError(postgrest)).toBe(
      "23505 · duplicate key value · Key (id) already exists. · Use upsert."
    );
  });

  it("joins only the string fields when the shape is partial", () => {
    expect(formatSyncError({ code: "PGRST301", hint: "Check RLS." })).toBe(
      "PGRST301 · Check RLS."
    );
  });

  it("serializes an error-shaped object with no string fields (numeric code)", () => {
    expect(formatSyncError({ code: 500 })).toBe('{"code":500}');
  });

  it("stringifies a circular object instead of throwing", () => {
    const circular: Record<string, unknown> = { code: 1 };
    circular.self = circular;
    expect(formatSyncError(circular)).toBe("[object Object]");
  });

  it("stringifies primitives", () => {
    expect(formatSyncError("plain string")).toBe("plain string");
    expect(formatSyncError(42)).toBe("42");
    expect(formatSyncError(undefined)).toBe("undefined");
  });
});
