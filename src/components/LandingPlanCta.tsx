"use client";

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { startCheckout } from "@/lib/account.functions";

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
  const requestCheckout = useServerFn(startCheckout);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    import("@/integrations/supabase/client")
      .then(({ supabase }) => {
        supabase.auth.getSession().then(({ data }) => {
          if (active) setSignedIn(Boolean(data.session));
        });
      })
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
      try {
        const result = await requestCheckout({ data: { tier: checkoutTier, cadence: "monthly" } });
        if (result.ok) {
          window.location.href = result.url;
        } else {
          setError(result.error);
          setBusy(false);
        }
      } catch {
        setError("Could not start checkout. Please try again.");
        setBusy(false);
      }
    },
    [requestCheckout],
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
