import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AuthLayout, authButton, authInput } from "@/components/AuthLayout";
import { claimReferral } from "@/lib/affiliate.functions";
import { readRefCookie } from "@/lib/use-ref-capture";

// Affiliate attribution lock — for accounts created before the ref cookie
// existed (e.g. email-confirmation signups, whose first session happens
// here). First attribution wins; best-effort, never blocks login.
async function lockReferral(claimFn: (input: { data: { code: string; sourceUrl?: string } }) => Promise<{ claimed: boolean }>) {
  try {      const refCode = readRefCookie();
      if (refCode) {
        const sourceUrl = typeof window !== "undefined" ? window.location.href : "";
        await claimFn({ data: { code: refCode, ...(sourceUrl ? { sourceUrl } : {}) } });
      }
  } catch {
    // attribution is best-effort
  }
}

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — theBizScope" },
      { name: "description", content: "Log in to your theBizScope dashboard." },
    ],
    // Checkout intent (?tier=&cadence=&email=) survives a redirect to login.
    validateSearch: (
      search: Record<string, unknown>,
    ): {
      email?: string | undefined;
      tier?: "watch" | "advise" | undefined;
      cadence?: "monthly" | "yearly" | undefined;
    } => {
      const tier = typeof search["tier"] === "string" ? search["tier"] : undefined;
      const cadence = typeof search["cadence"] === "string" ? search["cadence"] : undefined;
      return {
        email: typeof search["email"] === "string" && search["email"] ? search["email"] : undefined,
        tier: tier === "watch" || tier === "advise" ? tier : undefined,
        cadence: cadence === "monthly" || cadence === "yearly" ? cadence : undefined,
      };
    },
  }),
  component: LoginPage,
});

// Loosely-typed generated route tree — assert the validated search shape.
type LoginSearch = {
  email?: string | undefined;
  tier?: "watch" | "advise" | undefined;
  cadence?: "monthly" | "yearly" | undefined;
};

function LoginPage() {
  const { email: presetEmail, tier, cadence } = Route.useSearch() as LoginSearch;
  const claimReferralFn = useServerFn(claimReferral);
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const hasCheckoutIntent = Boolean(tier && cadence);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    setError("");
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        // "Invalid login credentials" is also what Supabase returns when the
        // email isn't registered at all — route those to signup instead of a
        // dead end, preserving any checkout intent and the typed email.
        if (signInError.message === "Invalid login credentials") {
          await router.navigate({
            to: "/signup",
            search: {
              email,
              ...(hasCheckoutIntent ? { tier, cadence } : {}),
            },
          });
          return;
        }
        setError(signInError.message);
        setLoading(false);
        return;
      }
      await lockReferral(claimReferralFn);
      await router.navigate(
        hasCheckoutIntent
          ? { to: "/pricing", search: { tier, cadence } }
          : { to: "/dashboard" },
      );
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow={hasCheckoutIntent ? "Almost yours" : "Account"}
      title={hasCheckoutIntent ? "Log in to subscribe." : "Welcome back."}
      subtitle={
        hasCheckoutIntent
          ? "Your plan is saved — it resumes right after login."
          : "Log in to see your business profile and weekly briefs."
      }
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link to="/signup" className="underline decoration-rule underline-offset-2 hover:text-foreground">
            Create one free
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <input
          className={authInput}
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@yoursalon.com"
          aria-label="Email address"
          defaultValue={presetEmail ?? ""}
        />
        <input
          className={authInput}
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Password"
        />
        {error && <p className="text-sm text-signal-red">{error}</p>}
        <button type="submit" disabled={loading} className={authButton}>
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthLayout>
  );
}