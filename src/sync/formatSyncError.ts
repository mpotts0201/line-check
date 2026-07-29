// Turns whatever a catch path traps into a human-readable line for a status
// display (SyncBar's sync status, the History screen's load error). Errors
// arrive as `unknown`, so narrow structurally rather than casting; Postgrest-
// shaped objects (code/message/details/hint) still format usefully if one ever
// surfaces this way.
export function formatSyncError(error: unknown): string {
  // Error first: an Error also satisfies the object check below, and its `message` is the
  // whole story. Checking it second would make this branch unreachable.
  if (error instanceof Error && error.message.length > 0) return error.message;

  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    const parts = [e.code, e.message, e.details, e.hint]
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    if (parts.length > 0) return parts.join(" · ");
    // Shaped like an error but with no string fields (e.g. a numeric `code`). Serialize
    // rather than fall through to String(), which would render "[object Object]" — exactly
    // as undiagnosable as the message this whole change replaced.
    try {
      return JSON.stringify(error);
    } catch {
      return String(error); // circular reference
    }
  }
  return String(error);
}
