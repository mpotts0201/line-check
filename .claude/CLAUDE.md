# CLAUDE.md — LineCheck

## What this project is

LineCheck is an **offline-first restaurant operations audit app** (React Native, portfolio project). Restaurant managers do daily food-safety line checks — often on paper, often in walk-in coolers with no wifi. LineCheck digitizes the audit: pass/fail checks per station, temperature readings, photos, notes, and a completion signature. Everything works fully offline and syncs to a backend when connectivity returns.

Primary goal: a tight, demo-able vertical slice with senior-level architecture (offline-first + sync), not a feature buffet.

## Critical environment rules — READ FIRST

This repo is developed in a **split Windows/WSL2 workflow**:

- **Claude Code runs in WSL2** and accesses this repo via `/mnt/c/dev/linecheck`
- **All commands run on the Windows side by the human** — Metro, installs, builds
- The dev device is a **physical iPhone via Expo Go / dev builds**, connecting to Metro over LAN

Therefore, Claude MUST follow these rules:

1. **NEVER run** `npm install`, `npm run`, `npx expo`, `eas`, or any build/run/start command. Linux binaries in node_modules will break the Windows-run app. Instead, tell the human what to run in Windows Terminal.
2. **NEVER add dependencies by editing package.json versions by hand.** Ask the human to run `npx expo install <package>` (Expo-managed packages) or `npm install <package>` on Windows.
3. **After changes to app.json, babel/metro config, or native-adjacent packages**, remind the human to restart Metro.
4. All files use **LF line endings** (`.gitattributes` enforces this). Do not introduce CRLF.
5. Editing code, reading files, refactoring, writing tests: all fine, no restrictions.

## Stack

- **Expo SDK 54** (pinned for App Store Expo Go compatibility — do NOT upgrade the SDK without being asked)
- **Expo Router** — file-based routing, all routes in `app/`
- **TypeScript** — strict mode; no `any` unless unavoidable and commented
- **Zustand** — UI/session state
- **expo-sqlite** — local source of truth; the app must be fully functional offline
- **Supabase** — remote mirror (Postgres + storage bucket for photos); sync only, never the primary read path
- **@react-native-community/netinfo** — connectivity detection for sync triggers
- **react-native-reanimated** — used sparingly for polish
- **expo-camera / expo-image-picker** — photo capture; **react-native-signature-canvas** — signatures

Everything must remain **Expo Go (SDK 54) compatible** until we deliberately move to a dev build. Do not introduce libraries requiring custom native code without flagging it.

## Architecture

### Offline-first data flow
1. UI writes go to **SQLite immediately** (optimistic, no spinners for local ops)
2. Every mutation also appends a row to `sync_queue`
3. A NetInfo listener + manual pull-to-sync flushes the queue when online: audits → audit_items → photo uploads
4. Retries use exponential backoff (`attempts` column); conflict resolution is **last-write-wins on `updatedAt`**
5. Sync state is always visible in the UI (pending badges, "N items waiting to sync")

### Data model (SQLite)
- `locations`: id, name, address
- `audits`: id, locationId, status ('draft' | 'complete'), startedAt, completedAt, signatureUri, syncStatus
- `audit_items`: id, auditId, station, label, result ('pass' | 'fail' | 'na'), tempReading, note, photoUri, updatedAt
- `sync_queue`: id, entity, entityId, operation, payload (JSON), createdAt, attempts

IDs are client-generated UUIDs (so offline creation never blocks on the server).

### Screens (Expo Router, in `app/`)
- `index` — Locations list
- `audit/[locationId]` — today's checklist, grouped by station
- `audit/item/[itemId]` — item detail: pass/fail, temp, photo, note
- `audit/review/[auditId]` — summary + signature + Complete
- `history` — past audits with sync badges

## Conventions

- Functional components + hooks only; no classes
- Data access goes through a repository layer in `src/db/` — screens never touch SQL directly
- Sync engine lives in `src/sync/` — isolated and unit-testable without UI
- Keep components small; co-locate screen-specific components near their route
- Descriptive commit messages; one logical change per commit
- When making a non-obvious tradeoff, append a short entry to `DECISIONS.md` (date, decision, why, alternatives considered)

## What NOT to do

- No auth (out of scope for the POC; listed in README as "next at production scale")
- No localStorage/AsyncStorage as a data store — SQLite is the source of truth
- No premature abstractions or extra screens beyond the list above
- No SDK upgrades, no ejecting, no `expo prebuild` — flag first, human decides