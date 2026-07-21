-- LineCheck — Supabase (remote mirror) schema
--
-- ⚠ DO NOT RUN THIS AGAINST THE LIVE PROJECT. It is a transcript, not a migration. Every
-- statement is `create table if not exists`, so running it against tables that have already
-- drifted silently no-ops and reports success — manufacturing exactly the false "local and
-- remote agree" confidence that caused the signature_uri/signature_path incident below.
-- To change the remote schema, ALTER it in the dashboard and re-transcribe this file.
--
-- Transcribed from the live project on 2026-07-21 via information_schema, AFTER the tables
-- had already been created by hand in the dashboard. It is a record of the remote contract,
-- not the thing that provisioned it. Checked in because the absence of exactly this file is
-- what let `flush.ts` write `signature_uri` against a `signature_path` column undetected:
-- the mismatch was invisible locally and surfaced only as a generic "Sync failed".
--
-- SQLite (src/db/index.ts) is the source of truth and stays camelCase; this side is
-- snake_case. The local→remote mapping lives in `toRemoteAudit`/`toRemoteItem`
-- (src/sync/flush.ts) — if you change a column here, change it there in the same commit.
--
-- RLS is deliberately OFF: the POC has no auth (see CLAUDE.md "What NOT to do"), so the anon
-- key writes directly. This is acceptable for a portfolio demo and NOT for production —
-- README lists auth + per-tenant RLS as the first production-scale item.

create table if not exists locations (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  address text not null
);

create table if not exists checklist_templates (
  id            uuid primary key default gen_random_uuid(),
  station       text    not null,
  label         text    not null,
  requires_temp boolean not null default false,
  sort_order    integer not null
);

-- Client-generated ids: no default here, unlike the two seed tables above. Audits are created
-- offline, so the device mints the uuid (expo-crypto) and the server must accept it — that is
-- what makes the upsert idempotent on retry.
create table if not exists audits (
  id             uuid primary key,
  location_id    uuid not null references locations (id),
  status         text not null default 'draft',
  started_at     timestamptz not null,
  completed_at   timestamptz,
  -- Storage object path once 8a uploads the signature; null until then.
  signature_path text
);

create table if not exists audit_items (
  id           uuid primary key,
  audit_id     uuid not null references audits (id),
  template_id  uuid references checklist_templates (id),
  station      text not null,
  label        text not null,
  result       text,
  temp_reading numeric,
  note         text,
  -- Storage object path once 8a uploads the photo; not written by the flush worker yet.
  photo_path   text,
  -- The last-write-wins clock the sync engine compares on. Stamped by the device
  -- (updateAuditItem), never by the server, so it reflects when the edit actually happened
  -- offline rather than when it reached us.
  updated_at   timestamptz not null
);
