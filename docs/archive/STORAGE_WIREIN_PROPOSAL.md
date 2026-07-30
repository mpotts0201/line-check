# Storage Wire-in — Implementation Proposal

**Status: BUILT 2026-07-30 — gate passed same day (owner reviewed the doc and
took all three recommendations: orphan-object accepted, sequential uploads,
base64-arraybuffer package). Implemented as specified below; DECISIONS
2026-07-30 entry + README storage-limitations section written. DEVICE PASS
DONE 2026-07-30: first sync hit the missing-select-policy gotcha (see Known
gotchas — confirmed, fixed with the third policy), retry drained the queue,
PNG verified in the bucket (transparent background — pad exports don't bake
in the on-screen backgroundColor; accepted as the better composable artifact,
dashboard's dark preview just renders it blank-looking). OUTSTANDING:
jest/eslint on Windows.**
Follow-on to `SIGNATURE_CAPTURE_PROPOSAL.md` (committed `4522a67`, device-verified).

## What and why

`audits.signatureUri` holds a real local PNG now, but the flush sends that
device-local `file://` URI into the remote `signature_path` column — a
documented placeholder, meaningless to any other device. This ticket uploads
the PNG to the owner's Supabase Storage bucket during sync and stores the
**object path** remotely instead, completing the round trip: sign offline →
PNG on device → reconnect → image in the bucket + row pointing at it.

**Godot analogy (from the design conversation):** Postgres rows and Storage
objects only connect by convention, like a scene storing
`res://sprites/player.png` rather than embedding pixels. `signature_path` is
the `res://` reference; the bucket is the filesystem it resolves against.
Today we store the equivalent of an absolute path on one machine — this ticket
makes it a real `res://` path.

## Decisions already made with the owner (recorded, not reopened)

1. **Upload inline in the flush, BEFORE the row upserts** — one sync ceremony,
   inherits the no-retry/queue-intact failure model unchanged, and a synced
   row never references an object that doesn't exist. (Two-phase upload
   rejected: doubles the sync states for a ~20KB file; completion-time upload
   rejected: breaks offline-first.)
2. **Dedicated public `signatures` bucket** — owner created it: public-read,
   1MB file limit, `image/png` MIME restriction. Object path = `<auditId>.png`
   at bucket root (deterministic → retries idempotently overwrite via
   `upsert: true`, matching the local filename convention).
3. **`signature_path` stores the in-bucket object path** (`<auditId>.png`),
   not a URL — URLs derive from paths at read time; the bucket name lives as
   a constant in code.
4. **Policies are DONE**: owner ran both RLS policies on `storage.objects`
   (insert + update, `to anon`, scoped `bucket_id = 'signatures'`) in the SQL
   Editor. Public-read + anon-write is the documented POC posture (README
   known-limitations, alongside RLS-off).

## The two design points this doc gates

### A. The DI seam grows a storage slice

`SyncClient` (flush.ts's seam) currently exposes only `from().upsert()`. The
upload needs `storage.from(bucket).upload(...)`. Extend the interface to
mirror the real client's shape — the same structural-typing trick the seam
already uses, NOT a new hand-rolled injection point:

```ts
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
```

The real `supabase` client satisfies this structurally with zero changes; the
test fake scripts a `storage` branch next to its existing `from` branch.

### B. Reading the PNG stays out of flush.ts's imports — via src/files

flush.ts must not import expo-file-system directly: the flush tests run
against real SQLite fakes with no native mocks, and keeping it that way is
the point of the seam. Instead, `src/files/signature.ts` (which already owns
the signature-file convention) gains:

```ts
export async function readSignatureBase64(fileUri: string): Promise<string> {
  return FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}
```

flush.ts imports it, and `flush.test.ts` mocks the module with `jest.mock` —
the exact precedent `syncEngine.test.ts` set for flush/netinfo (repo's
established pattern; no new DI plumbing).

## The flush walk (the load-bearing change)

New stage inside the existing `try`, before the audits upsert. Payloads are
parsed once up front so the upload loop and the upsert map read the same
objects:

```ts
const SIGNATURES_BUCKET = "signatures";

// inside flushSyncQueue, replacing the parse-inside-upsert calls:
const auditPayloads = auditRows.map((r) => JSON.parse(r.payload));
const itemPayloads = itemRows.map((r) => JSON.parse(r.payload));

try {
  // NEW: signatures to Storage first — a synced row must never point at an
  // object that isn't there. Sequential on purpose: a batch is nearly always
  // one audit, and the queue-intact retry model makes ordering trivial to
  // reason about. Deterministic path + upsert:true → a re-run after a
  // mid-flush crash overwrites, mirroring the row upserts' merge behavior.
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
    // existing audits upsert, now mapping over auditPayloads
  }
  // existing items upsert unchanged
} catch ...  // existing catch already covers a thrown read/upload
```

And `toRemoteAudit` swaps the placeholder for the real reference:

```ts
signature_path: p.signatureUri ? `${p.id}.png` : null,
```

Null-signature audits (old dev data predating the feature) skip the upload
and sync `signature_path: null` — no special casing beyond the `if`.

**Failure semantics: unchanged, verbatim.** Upload error or thrown file read →
`failed` set → the existing choke-point `console.warn` → `{status:"error"}` →
queue intact → next poke retries everything. One accepted partial state: if
the upload succeeds but the row upsert fails, the bucket briefly holds an
object no row references; the retry overwrites it and lands the row. Worst
case (audit never syncs) is one orphaned ~20KB object — accepted for the POC.

## base64 → ArrayBuffer

`upload()` wants an ArrayBuffer; RN's Blob-from-`fetch(file://)` route is
notoriously flaky in Expo. The Supabase docs' own RN pattern is the zero-dep
`base64-arraybuffer` package (`decode(base64)`). Hand-rolling ~6 lines on
Hermes's `atob` is defensible, but per the owner's standing "practical over
hand-rolled" call: use the package.

**Install (human, Windows Terminal):** `npm install base64-arraybuffer`
(pure JS — no Metro restart strictly required, but harmless).

## Tests (`src/sync/flush.test.ts`)

- Fake client grows a scripted `storage.from().upload()` branch;
  `jest.mock("../files/signature")` supplies a canned base64.
- New/updated cases:
  1. Happy path: upload called with `<auditId>.png` + contentType/upsert
     options, and the audits upsert receives `signature_path: "aud-1.png"` —
     NOT the `file://` URI (updates the existing pass-through assertion).
  2. Upload failure: `{status:"error"}`, queue intact, and the audits upsert
     was never attempted (proves upload-before-rows ordering).
  3. Null `signatureUri` payload: no upload call, `signature_path: null`.
- Seed's `signatureUri` stays the realistic `file:///doc/signature-aud-1.png`.

## Docs riding the implementation commit

- **DECISIONS.md**: inline-in-flush choice + the public-bucket POC tradeoff
  (capability-URL reasoning, 1MB/PNG-only caps, `to anon` policies; production
  = private bucket, authenticated policies, signed URLs).
- **README known-limitations**: public bucket + anon-key storage policies
  entry next to the RLS-off note.
- **flush.ts comment block**: the "placeholder / upload must map the
  POST-UPLOAD path" paragraph finally resolves — rewrite to describe the real
  behavior. `photoUri` remains the deferred half.
- **TODO.md + plain-English twin**: check off / update in place.

## Known gotchas

- **contentType is not optional.** The bucket's MIME restriction rejects
  anything not `image/png`; without an explicit `contentType`, storage infers
  `application/octet-stream` and the upload fails. The option in the code
  above is load-bearing, not hygiene.
- **Upsert needs the select policy — CONFIRMED on device day.** Predicted
  here as a retry-only risk; reality was stricter: with only insert + update
  policies, EVERY `x-upsert: true` upload failed ("new row violates row-level
  security policy") while plain inserts succeeded — curl-isolated outside the
  app. The storage API's upsert path requires the object row to be visible to
  the role. Fix: third policy, `for select to anon`, same bucket scope. All
  three policies are now live; DECISIONS Decision 3 records it.
- **Expo Go**: no new native code (supabase-js storage is plain fetch), so no
  Metro/native risk. The device pass still exercises airplane-mode → complete
  → reconnect → verify the object appears in the dashboard's bucket browser.

## Open questions for owner gate

1. **Accept the orphan-object partial state?** (Upload lands, row upsert
   fails, audit never re-syncs → one stray PNG.) Recommend yes for POC.
2. **Sequential uploads OK?** Parallelizing buys nothing at batch-size ~1 and
   complicates the failure story. Recommend sequential.
3. **`base64-arraybuffer` package vs hand-rolled `atob`?** Recommend package
   (Supabase's documented RN pattern).
