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

// Completion gate for T5's review screen: an audit is submittable only when EVERY item
// is answered. Applies the same "no blank submissions" rule as itemSaveSchema, but
// audit-wide — a null result fails z.enum, so an array containing any unanswered item
// fails safeParse, which IS the gate. requiresTemp rides on each AuditItem (joined from
// checklist_templates), so each element self-validates its temp requirement and no
// factory is needed. Kept here (not in the screen) so the rule lives in one place.
const completableItemSchema = z
  .object({
    result: z.enum(["pass", "fail", "na"]), // null → fails → audit not completable
    tempReading: z.number().nullable(),
    requiresTemp: z.boolean(),
  })
  .refine((v) => !v.requiresTemp || v.tempReading != null, {
    message: "Temperature required",
    path: ["tempReading"],
  });

export const auditCompleteSchema = z.object({
  items: z.array(completableItemSchema).min(1), // an empty audit isn't completable
});

export type AuditCompleteInput = z.infer<typeof auditCompleteSchema>;
