import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthLayout, authButton, authInput } from "@/components/AuthLayout";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — Localscope" },
      { name: "description", content: "Log in to your Localscope dashboard." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
        setError(signInError.message);
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
      eyebrow="Account"
      title="Welcome back."
      subtitle="Log in to see your business profile and weekly briefs."
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