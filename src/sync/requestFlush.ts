// Bridge between screens and the live sync coordinator. The coordinator is created inside
// the app root (it needs the db handle and the NetInfo subscription), but the screen that
// completes an audit needs to poke it. The root registers the coordinator's requestFlush
// here on mount and unregisters on unmount; screens just call requestFlush(), fire-and-
// forget. If nothing is registered (root not mounted, or a test rendering a screen alone)
// the call does nothing — the audit is already safe in SQLite, and the connectivity-
// regained trigger and manual Sync now still cover it.
let requester: (() => void) | null = null;

export function registerFlushRequester(fn: (() => void) | null): void {
  requester = fn;
}

export function requestFlush(): void {
  requester?.();
}
