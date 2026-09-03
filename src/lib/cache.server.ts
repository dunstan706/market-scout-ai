// Tiny in-memory TTL cache for expensive external lookups (geocoding, Places
// searches). Reduces repeat cost when the same request hits the public demo
// repeatedly. Failures are never cached — callers only store successful results,
// so transient errors retry naturally.
//
// Single-instance only, like rate-limit.server.ts. A multi-instance deployment
// should move this (and rate limiting) to a shared store such as Supabase.

type CacheEntry<T> = { value: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  maybeCleanup();
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): T {
  maybeCleanup();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

// Opportunistic cleanup so one-off keys (user-typed locations) don't grow the
// map forever. Runs at most once per interval regardless of call frequency.
let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

function maybeCleanup(now = Date.now()) {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  for (const [key, entry] of store) {
    if (Date.now() >= entry.expiresAt) store.delete(key);
  }
}