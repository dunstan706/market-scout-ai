"use client";

import { useEffect } from "react";

// Affiliate link capture. A visitor arriving via /?ref=code gets a
// first-party cookie holding the code, which signup reads to lock
// attribution (see affiliate.functions.ts / claimReferral). First-click
// wins: an existing cookie is never overwritten. 60 days matches the
// attribution window in the affiliate terms.
const REF_COOKIE = "tbs_ref";
const REF_MAX_AGE = 60 * 24 * 60 * 60; // 60 days, seconds

export function readRefCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)tbs_ref=([^;]*)/);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

export function RefCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (!ref || !/^[a-z0-9][a-z0-9-]{1,40}$/i.test(ref)) return;
      const existing = readRefCookie();
      if (existing) return; // first click wins
      document.cookie = `${REF_COOKIE}=${encodeURIComponent(ref as string)}; max-age=${REF_MAX_AGE}; path=/; SameSite=Lax`;
    } catch {
      // Cookie blocked — attribution just doesn't happen for this visitor.
    }
  }, []);
  return null;
}
