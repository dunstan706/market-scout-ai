import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";

// Pricing CTA for the landing page plans. The funnel is: plan → sign up →
// dashboard, where the plans overlay auto-opens for accounts without a
// subscription. Logged-in users go straight to the dashboard; logged-out
// visitors go to signup. Checkout itself happens from the dashboard overlay
// or the pricing page — never directly from the landing page.
export function LandingPlanCta({
  tier,
  fallbackHref,
  fallbackLabel,
}: {
  tier: "watch" | "advise" | null;
  fallbackHref: string;
  fallbackLabel: string;
}) {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    import("@/integrations/supabase/client")
      .then(({ supabase }) =>
        supabase.auth.getUser().then(({ data }) => {
          if (active) setSignedIn(Boolean(data.user));
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

  // No tier (the quote-only Expand plan) always keeps its original link.
  if (tier === null) {
    return (
      <a href={fallbackHref} className="mt-auto pt-8 inline-block text-center text-sm font-medium">
        <span className="inline-block w-full rounded-sm border border-ink px-4 py-2.5 transition-colors hover:bg-ink hover:text-primary-foreground">
          {fallbackLabel}
        </span>
      </a>
    );
  }

  if (signedIn === null) {
    // Session unknown — render a disabled placeholder to avoid layout shift.
    return (
      <div className="mt-auto pt-8 text-center text-sm font-medium">
        <span className="inline-block w-full rounded-sm border border-ink px-4 py-2.5 opacity-50 transition-colors">
          {fallbackLabel}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-auto pt-8 text-center text-sm font-medium">
      <button
        type="button"
        onClick={() => router.navigate({ to: signedIn ? "/dashboard" : "/signup" })}
        className="inline-block w-full rounded-sm bg-primary px-4 py-2.5 text-primary-foreground transition-colors hover:bg-accent"
      >
        {signedIn ? "Go to dashboard" : "Sign up to subscribe"}
      </button>
    </div>
  );
}
