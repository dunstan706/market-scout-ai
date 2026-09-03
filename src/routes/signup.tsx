import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthLayout, authButton, authInput } from "@/components/AuthLayout";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create your account — Localscope" },
      { name: "description", content: "Create a free Localscope account for your salon or spa." },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

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
      await router.navigate({ to: "/dashboard" });
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Free early access"
      title="Create your account."
      subtitle="Save your salon's details and generate briefs for your own neighbourhood."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="underline decoration-rule underline-offset-2 hover:text-foreground">
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
          {loading ? "Creating account…" : "Create account"}
        </button>
        <p className="text-xs text-muted-foreground">
          Free while Localscope is in early access. No card required.
        </p>
      </form>
    </AuthLayout>
  );
}