import { createFileRoute, Link, Navigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ConstellationGrid } from "@/components/ConstellationGrid";
import { AnimatedNavFramer, type AnimatedNavItem } from "@/components/ui/animated-nav-framer";
import { UpgradeOverlay } from "@/components/UpgradeOverlay";
import {
  listBusinesses,
  saveProfile,
  sendTestBriefEmail,
  type Business,
  type BusinessType,
  type Profile,
} from "@/lib/account.functions";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Localscope" },
      { name: "description", content: "Your Localscope account and business details." },
    ],
  }),
  component: ProfilePage,
});

const BUSINESS_TYPES: Array<{ value: BusinessType; label: string }> = [
  { value: "salon", label: "Salon" },
  { value: "spa", label: "Spa" },
  { value: "other", label: "Other" },
];

const inputCls =
  "w-full rounded-sm border border-rule/80 bg-card/50 px-3.5 py-3 text-sm text-foreground backdrop-blur-sm transition-colors placeholder:text-muted-foreground/60 focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20";

function ProfilePage() {
  const router = useRouter();
  const fetchBusinesses = useServerFn(listBusinesses);
  const persistProfile = useServerFn(saveProfile);

  const [authChecked, setAuthChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [businesses, setBusinesses] = useState<Business[]>([]);

  // Profile editor state — same fields as the dashboard's Details tab.
  const [draft, setDraft] = useState<Profile>({
    businessName: "",
    businessType: "salon",
    location: "",
    pricePoint: "",
  });
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [savedError, setSavedError] = useState("");

  // Weekly-brief email test button.
  const sendTestEmail = useServerFn(sendTestBriefEmail);
  const [emailSending, setEmailSending] = useState(false);
  const [emailFlash, setEmailFlash] = useState<{ ok: boolean; message: string } | null>(null);

  async function onSendTestEmail() {
    setEmailSending(true);
    setEmailFlash(null);
    try {
      const result = await sendTestEmail();
      setEmailFlash(
        result.ok
          ? { ok: true, message: `Test brief sent to ${email}. Check your inbox (and spam).` }
          : { ok: false, message: result.error ?? "Could not send the test email." },
      );
    } catch (err) {
      console.error(err);
      setEmailFlash({ ok: false, message: "Could not send the test email." });
    } finally {
      setEmailSending(false);
    }
  }

  // Plans / upgrade overlay (shared with the dashboard).
  const [pricingOpen, setPricingOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session?.user) {
        setAuthChecked(true);
        return;
      }
      setSignedIn(true);
      setEmail(data.session.user.email ?? "");
      try {
        const { businesses: list } = await fetchBusinesses();
        if (cancelled) return;
        setBusinesses(list);
        const first = list[0];
        if (first) {
          setDraft({
            businessName: first.businessName,
            businessType: first.businessType,
            location: first.location,
            pricePoint: first.pricePoint ?? "",
          });
        }
      } catch {
        // Signed-out, expired, or schema not ready — leave the form blank.
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchBusinesses]);

  async function onSaveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setSavedFlash(false);
    setSavedError("");
    try {
      await persistProfile({ data: draft });
      setBusinesses((prev) => {
        const rest = prev.filter((b) => b.id !== "profile");
        return rest.length > 0 ? rest : [{ id: "profile", ...draft }];
      });
      setSavedFlash(true);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Could not save your business details.";
      console.error(err);
      setSavedError(message);
    } finally {
      setSaving(false);
    }
  }

  async function onSignOut() {
    await supabase.auth.signOut();
    await router.navigate({ to: "/" });
  }

  if (authChecked && !signedIn) {
    return <Navigate to="/login" />;
  }

  // Nav dropdown: the account's businesses; picking one jumps to the globe.
  const businessMenuItems: AnimatedNavItem[] =
    businesses.length > 0
      ? businesses.map((b) => ({
          name: b.businessName || "Unnamed business",
          onClick: () => void router.navigate({ to: "/dashboardtest" }),
        }))
      : [{ name: "No businesses yet — add one from the dashboard" }];

  return (
    <main className="theme-dark relative h-screen w-full overflow-y-auto">
      {/* Page-wide constellation — same look as the globe dashboard, minus the
          globe warp. */}
      <ConstellationGrid className="fixed inset-0 h-screen w-full" warp={false} glowRadius={85} />

      {/* Expanded floating pill — dashboard navigation. */}
      <AnimatedNavFramer
        collapsible={false}
        logo={
          <Link to="/" className="whitespace-nowrap font-serif text-xl tracking-tight sm:text-2xl">
            Localscope<span className="text-accent">.</span>
          </Link>
        }
        items={[
          { name: "Business", children: businessMenuItems },
          { name: "Plans", onClick: () => setPricingOpen(true) },
          { name: "Profile", href: "/profile" },
          { name: "Sign out", onClick: onSignOut, danger: true },
        ]}
      />

      <div className="relative z-10 flex min-h-full items-center justify-center px-4 py-24">
        <div className="paper-card animate-rise w-full max-w-md rounded-md p-7 shadow-lift md:p-8">
          <p className="eyebrow">Account</p>
          <h1 className="mt-2 font-serif text-3xl">Your profile</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Your account, your plan, and the business Localscope watches for you.
          </p>

          <dl className="mt-6 space-y-3 border-b border-rule pb-5 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-muted-foreground">Email</dt>
              <dd className="truncate text-foreground">{email || "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-muted-foreground">Plan</dt>
              <dd className="flex items-center gap-2">
                <span className="text-foreground">Watch</span>
                <button
                  type="button"
                  onClick={() => setPricingOpen(true)}
                  className="rounded-sm border border-rule px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                >
                  See plans
                </button>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-muted-foreground">Businesses</dt>
              <dd className="text-foreground">
                {businesses.length} of 1
                <span className="text-muted-foreground"> on Watch</span>
              </dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={() => void onSendTestEmail()}
            disabled={emailSending}
            className="w-full rounded-sm border border-rule px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {emailSending ? "Sending…" : "Email me a test brief"}
          </button>
          {emailFlash && (
            <p className={emailFlash.ok ? "mt-2 text-sm text-signal-green" : "mt-2 text-sm text-signal-red"}>
              {emailFlash.message}
            </p>
          )}

          <form onSubmit={onSaveDetails} className="mt-5 space-y-2.5" noValidate>
            <p className="eyebrow">Business details</p>
            <input
              className={inputCls}
              name="businessName"
              required
              minLength={2}
              maxLength={120}
              placeholder="Business name"
              aria-label="Business name"
              value={draft.businessName}
              onChange={(e) => setDraft({ ...draft, businessName: e.target.value })}
            />
            <input
              className={inputCls}
              name="location"
              required
              minLength={2}
              maxLength={160}
              placeholder="Neighbourhood, city"
              aria-label="Location"
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            />
            <input
              className={inputCls}
              name="pricePoint"
              maxLength={40}
              placeholder="Your typical price (optional) — e.g. $45"
              aria-label="Your typical price"
              value={draft.pricePoint ?? ""}
              onChange={(e) => setDraft({ ...draft, pricePoint: e.target.value })}
            />
            <select
              className={inputCls}
              name="businessType"
              aria-label="Business type"
              value={draft.businessType}
              onChange={(e) =>
                setDraft({ ...draft, businessType: e.target.value as BusinessType })
              }
            >
              {BUSINESS_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-sm bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save details"}
            </button>
            {savedFlash && <p className="text-sm text-signal-green">Saved.</p>}
            {savedError && <p className="text-sm text-signal-red">{savedError}</p>}
          </form>

          <button
            type="button"
            onClick={onSignOut}
            className="mt-5 w-full rounded-sm border border-signal-red/50 px-4 py-2.5 text-sm font-medium text-signal-red transition-colors hover:bg-signal-red hover:text-white"
          >
            Sign out
          </button>
        </div>
      </div>

      <UpgradeOverlay open={pricingOpen} onClose={() => setPricingOpen(false)} />
    </main>
  );
}