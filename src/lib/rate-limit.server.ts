// In-memory sliding-window rate limiter for the public sample-brief generator.
// The generator costs real money per call (Google Places + website fetches + an
// LLM call), so it must not be unlimited or unauthenticated.
//
// Correct for single-instance deployments (Lovable Cloud / one server).
// Multi-instance deployments need a shared store (e.g. Supabase) instead —
// an in-memory limiter per instance only caps traffic per instance.

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_MAX_REQUESTS = 3;

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

function prune(bucket: Bucket, now: number, windowMs: number) {
  bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < windowMs);
}

// Opportunistic cleanup so abandoned keys don't grow the map forever.
let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

function maybeCleanup(now: number) {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  for (const [key, bucket] of buckets) {
    prune(bucket, now, WINDOW_MS);
    if (bucket.timestamps.length === 0) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  max = DEFAULT_MAX_REQUESTS,
  windowMs = WINDOW_MS,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  maybeCleanup(now);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  prune(bucket, now, windowMs);
  if (bucket.timestamps.length >= max) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  bucket.timestamps.push(now);
  return { allowed: true, retryAfterSeconds: 0 };
}

// Best-effort client IP. Behind a proxy/CDN the first hop of x-forwarded-for is
// the client; fall back to the headers Cloudflare/Nginx set. Returns undefined
// when nothing is present, in which case callers should use a shared key.
export function clientIpFromRequest(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    undefined
  );
}