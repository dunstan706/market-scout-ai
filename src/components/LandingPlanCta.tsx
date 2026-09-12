"use client";

import { useCallback, useEffect, useState } from "react";
import { usePaddleCheckout } from "@/lib/use-paddle-checkout";

// Pricing CTA for the landing page. Signed-in users get a real Paddle
// checkout button (monthly cadence — the landing shows monthly prices);
// logged-out visitors are sent to signup, which is the natural next step
// for them. Renders nothing until the session is known so a signed-in
// user never sees a misleading signup link.
export function LandingPlanCta({
  tier,
  featured,
  fallbackHref,
  fallbackLabel,
}: {
  tier: "watch" | "advise" | null;
  featured: boolean;
  fallbackHref: string;
  fallbackLabel: string;
}) {
  const { ready: paddleReady, error: paddleError, openCheckout } = usePaddleCheckout();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    import("@/integrations/supabase/client")
      .then(({ supabase }) =>
        supabase.auth.getUser().then(({ data }) => {
          if (!active) return;
          setSignedIn(Boolean(data.user));
          setUserEmail(data.user?.email ?? undefined);
        }),
      )
      .catch(() => {
        // Supabase env vars missing — nothing to authenticate against.
        if (active) setSignedIn(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const start = useCallback(
    async (checkoutTier: "watch" | "advise") => {
      setBusy(true);
      setError("");
      if (!paddleReady) {
        setError(paddleError || "Checkout is loading — one moment.");
        setBusy(false);
        return;
      }
      // Opens the Paddle.js one-page overlay directly — same proven path as
      // the pricing page. No server-minted transaction, no redirect.
      await openCheckout({ tier: checkoutTier, cadence: "monthly", email: userEmail });
      setBusy(false);
    },
    [paddleReady, paddleError, openCheckout, userEmail],
  );

  const shell = `inline-block w-full rounded-sm px-4 py-2.5 transition-colors ${
    featured ? "bg-primary text-primary-foreground hover:bg-accent" : "border border-ink hover:bg-primary hover:text-primary-foreground"
  }`;

  // No tier (the quote-only Expand plan) always keeps its original link.
  if (tier === null || signedIn === false) {
    return (
      <a href={fallbackHref} className="mt-auto pt-8 inline-block text-center text-sm font-medium">
        <span className={shell}>{fallbackLabel}</span>
      </a>
    );
  }

  if (signedIn === null) {
    // Session unknown — render a disabled placeholder to avoid layout shift.
    return (
      <div className="mt-auto pt-8 text-center text-sm font-medium">
        <span className={`${shell} opacity-50`}>{fallbackLabel}</span>
      </div>
    );
  }

  return (
    <div className="mt-auto pt-8 text-center text-sm font-medium">
      <button type="button" disabled={busy} onClick={() => start(tier)} className={shell}>
        {busy ? "Opening checkout…" : `Subscribe — ${tier === "watch" ? "Watch" : "Advise"}`}
      </button>
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
