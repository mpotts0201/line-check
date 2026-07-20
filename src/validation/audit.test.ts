import { auditCompleteSchema, itemSaveSchema } from "./audit";

// Tier-1 validation tests: pure schema behavior, no mocks, no db. These also serve as the
// harness's "green proof" — if jest runs these, the runner + transform are wired correctly.

describe("itemSaveSchema", () => {
  describe("when the item does NOT require a temp", () => {
    const schema = itemSaveSchema(false);

    it("accepts an answered item with null temp and note", () => {
      const r = schema.safeParse({ result: "pass", tempReading: null, note: null });
      expect(r.success).toBe(true);
    });

    it("rejects a blank result (the 'no blank submissions' rule)", () => {
      const r = schema.safeParse({ result: null, tempReading: null, note: null });
      expect(r.success).toBe(false);
    });
  });

  describe("when the item REQUIRES a temp", () => {
    const schema = itemSaveSchema(true);

    it("rejects a missing temp reading", () => {
      const r = schema.safeParse({ result: "pass", tempReading: null, note: null });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0].path).toEqual(["tempReading"]);
      }
    });

    it("accepts when a temp reading is provided", () => {
      const r = schema.safeParse({ result: "pass", tempReading: 38, note: "cold line" });
      expect(r.success).toBe(true);
    });
  });
});

describe("auditCompleteSchema", () => {
  const answered = { result: "pass", tempReading: null, requiresTemp: false };

  it("rejects an empty audit (no items)", () => {
    const r = auditCompleteSchema.safeParse({ items: [] });
    expect(r.success).toBe(false);
  });

  it("rejects an audit with any unanswered item", () => {
    const r = auditCompleteSchema.safeParse({
      items: [answered, { result: null, tempReading: null, requiresTemp: false }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts an audit where every item is answered", () => {
    const r = auditCompleteSchema.safeParse({
      items: [answered, { result: "fail", tempReading: null, requiresTemp: false }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a temp-required item with no reading", () => {
    const r = auditCompleteSchema.safeParse({
      items: [{ result: "pass", tempReading: null, requiresTemp: true }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts a temp-required item that has a reading", () => {
    const r = auditCompleteSchema.safeParse({
      items: [{ result: "pass", tempReading: 40, requiresTemp: true }],
    });
    expect(r.success).toBe(true);
  });
});
