import { decode } from "base64-arraybuffer";
import { type SqlDb } from "../db/types";
import { deleteSyncQueueRows, getPendingSyncQueue } from "../db/syncQueue";
import { markAuditsSynced } from "../db/audits";
import { readSignatureBase64 } from "../files/signature";

// The bucket is public-read with anon insert/update policies scoped to it — the
// documented POC posture (see DECISIONS 2026-07-30 and README known limitations).
const SIGNATURES_BUCKET = "signatures";

// The narrow slice of the Supabase client the worker needs — its DI seam. Typed with
// PromiseLike so BOTH the real (thenable) Postgrest builder and a Promise-returning test fake
// satisfy it. The worker takes this as a param and never imports the `supabase` singleton, so
// tests inject a scripted fake and the composition root (the screen) injects the real client.
// `storage` mirrors the real client's shape the same structural way — the real client
// satisfies it with zero changes; the fake scripts a storage branch next to `from`.
export interface SyncClient {
  from(table: string): {
    upsert(
      values: Record<string, unknown>[],
      options?: { onConflict?: string }
    ): PromiseLike<{ error: unknown }>;
  };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: ArrayBuffer,
        options?: { contentType?: string; upsert?: boolean }
      ): PromiseLike<{ error: unknown }>;
    };
  };
}

export type FlushResult =
  | { status: "empty" }
  | { status: "synced"; audits: number; items: number }
  | { status: "error"; error: unknown };

// camelCase local payload → snake_case remote row (the remote convention, matching the
// existing locations/checklist_templates tables). Also drops the local-only `syncStatus`;
// `photoUri` is deferred to 8a (Storage upload), so it is not sent here.
//
// NOTE the remote names are `signature_path` / `photo_path`, NOT `_uri`. Locally these hold a
// device `file://` URI; remotely they hold a Storage object path. `signature_path` is derived,
// not copied: the flush has already uploaded the PNG to `<auditId>.png` in the signatures
// bucket by the time this mapping runs, so the remote gets that in-bucket path — the local URI
// would be meaningless to any other device. Null signatureUri (audits predating the signature
// feature) maps to null. `photo_path` remains the deferred half of this pattern.
function toRemoteAudit(p: any): Record<string, unknown> {
  return {
    id: p.id,
    location_id: p.locationId,
    status: p.status,
    started_at: p.startedAt,
    completed_at: p.completedAt,
    signature_path: p.signatureUri ? `${p.id}.png` : null,
  };
}
function toRemoteItem(p: any): Record<string, unknown> {
  return {
    id: p.id,
    audit_id: p.auditId,
    template_id: p.templateId,
    station: p.station,
    label: p.label,
    result: p.result,
    temp_reading: p.tempReading,
    note: p.note,
    updated_at: p.updatedAt,
  };
}

// Drains sync_queue to Supabase. Reads all pending rows, uploads signature PNGs to Storage,
// then upserts parents (audits) to completion BEFORE children (audit_items) so FKs resolve
// server-side, then — only on confirmed success — deletes the flushed queue rows and flips
// syncStatus, atomically. Any returned error or thrown network failure returns early with
// the queue untouched, so the whole batch is safe to retry on the next poke. Upserts key on
// `id` and uploads overwrite a deterministic path, so a re-run after a mid-flush crash
// merges rather than duplicating.
export async function flushSyncQueue(db: SqlDb, client: SyncClient): Promise<FlushResult> {
  const pending = await getPendingSyncQueue(db);
  if (pending.length === 0) return { status: "empty" };

  const auditRows = pending.filter((r) => r.entity === "audits");
  const itemRows = pending.filter((r) => r.entity === "audit_items");
  // Parsed once: the upload loop and the upsert mappings read the same objects.
  const auditPayloads = auditRows.map((r) => JSON.parse(r.payload));
  const itemPayloads = itemRows.map((r) => JSON.parse(r.payload));

  let failed: unknown | null = null;
  try {
    // Signatures to Storage FIRST — a synced row must never reference an object that
    // isn't there. Sequential on purpose: a batch is nearly always one audit, and the
    // queue-intact retry model keeps the ordering trivial to reason about. contentType
    // is load-bearing, not hygiene: the bucket restricts MIME to image/png, and without
    // it storage infers application/octet-stream and rejects the upload. The accepted
    // partial state (upload lands, row upsert fails, audit never re-syncs → one orphan
    // ~20KB object) is a gate-approved POC tradeoff — see STORAGE_WIREIN_PROPOSAL.md.
    for (const p of auditPayloads) {
      if (failed !== null) break;
      if (p.signatureUri) {
        const base64 = await readSignatureBase64(p.signatureUri);
        const { error } = await client.storage
          .from(SIGNATURES_BUCKET)
          .upload(`${p.id}.png`, decode(base64), {
            contentType: "image/png",
            upsert: true,
          });
        if (error) failed = error;
      }
    }

    if (failed === null && auditPayloads.length > 0) {
      const { error } = await client
        .from("audits")
        .upsert(auditPayloads.map(toRemoteAudit), {
          onConflict: "id",
        });
      if (error) failed = error;
    }
    if (failed === null && itemPayloads.length > 0) {
      const { error } = await client
        .from("audit_items")
        .upsert(itemPayloads.map(toRemoteItem), {
          onConflict: "id",
        });
      if (error) failed = error;
    }
  } catch (error) {
    // Network throw (or a fake that throws mid-flush): nothing has been drained yet.
    failed = error ?? new Error("flush failed");
  }

  if (failed !== null) {
    // Surface the failure at the ONE choke point every trigger flows through — the
    // reconnect edge, Submit, and the manual button all end up here. Screens no longer
    // read the flush result, so without this line a failed push would be invisible.
    // In production this is where telemetry would hang.
    console.warn("[sync] flush failed", failed);
    // Leave the whole batch queued (all-or-nothing). Nothing is counted or scheduled:
    // the next poke — signal edge, Submit, manual button — simply retries all of it.
    return { status: "error", error: failed };
  }

  // Confirmed pushed → drain the flushed rows and flip syncStatus in one local transaction.
  await db.withTransactionAsync(async () => {
    await deleteSyncQueueRows(db, pending.map((r) => r.id));
    await markAuditsSynced(db, auditRows.map((r) => r.entityId));
  });

  return { status: "synced", audits: auditRows.length, items: itemRows.length };
}
