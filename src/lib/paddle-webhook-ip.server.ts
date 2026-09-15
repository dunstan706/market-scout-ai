// Paddle live-webhook source allowlist. On the live account, webhook
// deliveries originate only from Paddle's published IP ranges, so gating on
// them blocks forged requests before signature verification even runs
// (defense in depth — signature verification stays authoritative).
//
// The list is NOT hard-coded: Paddle's official source of truth is
// https://api.paddle.com/ips (data.ipv4_cidrs), and it can change. We fetch
// it, cache it, and fail OPEN on fetch errors so a transient Paddle API
// outage can never stop legitimate webhook deliveries (signatures still
// verify those). Fail-closed would risk silently dropping real payments.
//
// Sandbox deliveries come from different infrastructure, so the gate is
// active only when PADDLE_ENV=live.

import { cacheGet, cacheSet } from "@/lib/cache.server";

const PADDLE_IPS_URL = "https://api.paddle.com/ips";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — Paddle's ranges move rarely
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000; // don't re-hit a failing endpoint more than every 10 min

type PaddleIpsResponse = {
  data?: { ipv4_cidrs?: string[]; ipv6_cidrs?: string[] } | null;
};

export type PaddleIpAllowlist = {
  cidrs: string[];
  fetchedAt: number;
};

let lastFetchFailedAt = 0;

export async function getPaddleIpAllowlist(): Promise<PaddleIpAllowlist | null> {
  const cached = cacheGet<PaddleIpAllowlist>("paddle:webhook-ips");
  if (cached) return cached;

  // Negative cache: after a failed fetch, wait before trying again so the
  // webhook path doesn't add latency hammering a down endpoint.
  if (Date.now() - lastFetchFailedAt < NEGATIVE_CACHE_TTL_MS) return null;

  try {
    const response = await fetch(PADDLE_IPS_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as PaddleIpsResponse;
    const cidrs = (payload.data?.ipv4_cidrs ?? []).filter(
      (c) => typeof c === "string" && c.length > 0,
    );
    if (cidrs.length === 0) throw new Error("empty ipv4_cidrs");
    const allowlist: PaddleIpAllowlist = { cidrs, fetchedAt: Date.now() };
    cacheSet("paddle:webhook-ips", allowlist, CACHE_TTL_MS);
    return allowlist;
  } catch {
    lastFetchFailedAt = Date.now();
    return null;
  }
}

// IPv4 -> 32-bit unsigned int. Returns undefined for non-IPv4 input
// (e.g. IPv6 forwarded hops) — those skip the allowlist check rather than
// being rejected, for the same fail-open reason as above.
function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  let out = 0;
  for (const part of parts) {
    const n = Number.parseInt(part, 10);
    if (!Number.isInteger(n) || n < 0 || n > 255 || !/^\d{1,3}$/.test(part)) return undefined;
    out = out * 256 + n;
  }
  return out >>> 0;
}

function cidrToInts(cidr: string): { base: number; mask: number } | undefined {
  const [ip, bitsRaw] = cidr.split("/");
  if (ip === undefined) return undefined;
  const base = ipv4ToInt(ip);
  const bits = Number.parseInt(bitsRaw ?? "32", 10);
  if (base === undefined || !Number.isInteger(bits) || bits < 0 || bits > 32) return undefined;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: base & mask, mask };
}

export function ipInCidrs(ip: string, cidrs: string[]): boolean {
  const value = ipv4ToInt(ip);
  if (value === undefined) return false;
  for (const cidr of cidrs) {
    const range = cidrToInts(cidr);
    if (range && (value & range.mask) === range.base) return true;
  }
  return false;
}

// Gate for the webhook route. Returns a rejection reason, or null when the
// delivery may proceed (either allowlisted, or the list was unavailable /
// the environment isn't live).
export async function rejectPaddleWebhookSource(request: Request): Promise<string | null> {
  if (process.env["PADDLE_ENV"] !== "live") return null;

  const { clientIpFromRequest } = await import("@/lib/rate-limit.server");
  const ip = clientIpFromRequest(request);
  // No IP header at all (direct connection): treat as unknown and let
  // signature verification decide — Paddle's proxy chain always sets XFF.
  if (!ip) return null;

  const allowlist = await getPaddleIpAllowlist();
  // Fail open on fetch failure (transient outage) — signature check still guards.
  if (!allowlist) return null;

  if (!ipInCidrs(ip, allowlist.cidrs)) {
    return `Webhook received from non-Paddle IP ${ip}`;
  }
  return null;
}
