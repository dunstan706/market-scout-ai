import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AuthLayout, authButton, authInput } from "@/components/AuthLayout";
import { claimReferral } from "@/lib/affiliate.functions";
import { readRefCookie } from "@/lib/use-ref-capture";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create your account — theBizScope" },
      { name: "description", content: "Create a theBizScope account for your salon or spa." },
    ],
    // Coming from a Subscribe button: the checkout intent survives signup.
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
  component: SignupPage,
});

// The generated route tree in this project is loosely typed (Lovable's
// generator), so the validated search shape is asserted here instead of
// inferred — validateSearch above guarantees it at runtime.
type SignupSearch = {
  email?: string | undefined;
  tier?: "watch" | "advise" | undefined;
  cadence?: "monthly" | "yearly" | undefined;
};

// Affiliate attribution lock — signup only. The ref cookie was set on the
// visitor's first landing; claiming it once pins the customer to that
// affiliate forever. Best-effort: a failure never blocks account creation.
// Also called on the email-confirmation path (first login), below.
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

function SignupPage() {
  const { email: presetEmail, tier, cadence } = Route.useSearch() as SignupSearch;
  const router = useRouter();
  const claimReferralFn = useServerFn(claimReferral);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const hasCheckoutIntent = Boolean(tier && cadence);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }
      if (!data.session) {
        // Email confirmation is enabled on this Supabase project — ask the user
        // to confirm before their first log in.
        setNotice("Almost there — check your inbox for a confirmation link, then log in.");
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
      eyebrow={hasCheckoutIntent ? "Almost yours" : "Set up your market watch"}
      title={hasCheckoutIntent ? "Create your account to subscribe." : "Create your account."}
      subtitle={
        hasCheckoutIntent
          ? "Your plan is saved — it resumes right after signup."
          : "Save your salon's details and generate briefs for your own neighbourhood."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/login"
            {...(hasCheckoutIntent ? { search: { tier, cadence } } : {})}
            className="underline decoration-rule underline-offset-2 hover:text-foreground"
          >
            Log in
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
          minLength={6}
          autoComplete="new-password"
          placeholder="Password (6+ characters)"
          aria-label="Password"
        />
        {error && <p className="text-sm text-signal-red">{error}</p>}
        {notice && <p className="text-sm text-signal-green">{notice}</p>}
        <button type="submit" disabled={loading} className={authButton}>
          {loading
            ? "Creating account…"
            : hasCheckoutIntent
              ? "Create account & continue to checkout"
              : "Create account"}
        </button>
        <p className="text-xs text-muted-foreground">
          No card required to sign up — subscribe only when you're ready.
        </p>
      </form>
    </AuthLayout>
  );
}