import { z } from "zod";

// Domain-level validation for an item save. Lives here (not in the screen or the
// repository) so the same rules back both the item-detail Save and, later, T5's
// "can't complete an audit with unanswered items" gate — UI-agnostic and unit-testable.
//
// requiresTemp is a per-item flag (it rides on checklist_templates, joined into
// AuditItem), so the schema is built by a factory rather than being a static const.
// `result` has no null member on purpose: a blank submission fails parse, which is
// exactly the "no blank submissions" rule. safeParse's `.data` is MutableAuditItemFields
// shaped, so it flows straight into updateAuditItem with no re-mapping.
export function itemSaveSchema(requiresTemp: boolean) {
  return z
    .object({
      result: z.enum(["pass", "fail", "na"]),
      tempReading: z.number().nullable(),
      note: z.string().nullable(),
    })
    .refine((v) => !requiresTemp || v.tempReading != null, {
      message: "Temperature required for this item",
      path: ["tempReading"],
    });
}

export type ItemSaveInput = z.infer<ReturnType<typeof itemSaveSchema>>;
