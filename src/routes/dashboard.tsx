import { createFileRoute, Link, Navigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { BriefCard, type Signal } from "@/components/BriefCard";
import {
  getMyProfile,
  getMonitoringStatus,
  generateMonitoringBrief,
  listBriefs,
  saveProfile,
  type BriefRecord,
  type BusinessType,
  type MonitoringStatus,
  type Profile,
} from "@/lib/account.functions";
import type { Brief } from "@/lib/brief.functions";
import type { DetectedChange } from "@/lib/change-detection";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Localscope" },
      {
        name: "description",
        content: "Your Localscope dashboard — business profile, market monitoring, and weekly briefs.",
      },
    ],
  }),
  component: DashboardPage,
});

type ViewState = "checking" | "signedOut" | "ready";
type GenState = "idle" | "loading" | "done" | "error";

const BUSINESS_TYPES: Array<{ value: BusinessType; label: string }> = [
  { value: "salon", label: "Salon" },
  { value: "spa", label: "Spa" },
  { value: "other", label: "Other" },
];

const TONE_DOT: Record<DetectedChange["tone"], string> = {
  red: "bg-signal-red",
  amber: "bg-signal-amber",
  green: "bg-signal-green",
};

const EMPTY_STATUS: MonitoringStatus = {
  lastRunAt: null,
  baseline: true,
  snapshotCount: 0,
  changes: [],
};

function DashboardPage() {
  const router = useRouter();
  const getProfile = useServerFn(getMyProfile);
  const persistProfile = useServerFn(saveProfile);
  const runMonitoring = useServerFn(generateMonitoringBrief);
  const fetchBriefs = useServerFn(listBriefs);
  const fetchStatus = useServerFn(getMonitoringStatus);

  const [view, setView] = useState<ViewState>("checking");
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<Profile>({ businessName: "", businessType: "salon", location: "" });
  const [savedFlash, setSavedFlash] = useState(false);
  const [savedError, setSavedError] = useState("");

  const [status, setStatus] = useState<MonitoringStatus>(EMPTY_STATUS);
  const [briefs, setBriefs] = useState<BriefRecord[]>([]);
  const [latest, setLatest] = useState<Brief | null>(null);
  const [latestChanges, setLatestChanges] = useState<DetectedChange[]>([]);
  const [genState, setGenState] = useState<GenState>("idle");
  const [genError, setGenError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Client-side auth gate: the session lives in browser storage, so SSR can't
  // see it. Server functions below are protected server-side too.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const session = data.session;
      if (!session?.user) {
        setView("signedOut");
        return;
      }
      setEmail(session.user.email ?? "");
      try {
        const [{ profile: saved }, { briefs: stored }, { status: monitoring }] = await Promise.all([
          getProfile(),
          fetchBriefs(),
          fetchStatus(),
        ]);
        if (!active) return;
        if (saved) setProfile(saved);
        setBriefs(stored);
        setStatus(monitoring);
        setView("ready");
      } catch {
        if (!active) return;
        // Token missing/expired — treat as signed out so the user can log in again.
        setView("signedOut");
      }
    });
    return () => {
      active = false;
    };
  }, [getProfile, fetchBriefs, fetchStatus]);

  async function onSaveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavedFlash(false);
    setSavedError("");
    try {
      await persistProfile({ data: profile });
      setSavedFlash(true);
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Could not save your profile. Please try again.";
      console.error(err);
      setSavedError(message);
    }
  }

  async function onGenerate() {
    if (!profile.businessName.trim() || !profile.location.trim()) {
      setGenError("Save your business name and neighbourhood first.");
      setGenState("error");
      return;
    }
    setGenState("loading");
    setGenError("");
    setLatestChanges([]);
    try {
      const res = await runMonitoring();
      if (!res.ok) {
        setGenError(res.error);
        setGenState("error");
        return;
      }
      setLatest(res.brief);
      setLatestChanges(res.changes);
      setGenState("done");
      const [{ briefs: refreshed }, { status: monitoring }] = await Promise.all([
        fetchBriefs(),
        fetchStatus(),
      ]);
      setBriefs(refreshed);
      setStatus(monitoring);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setGenState("error");
    }
  }

  async function onSignOut() {
    await supabase.auth.signOut();
    await router.navigate({ to: "/" });
  }

  if (view === "checking") {
    return (
      <PageShell email={email} onSignOut={onSignOut}>
        Loading…
      </PageShell>
    );
  }
  if (view === "signedOut") {
    return <Navigate to="/login" />;
  }

  return (
    <PageShell email={email} onSignOut={onSignOut}>
      <div className="rule-double pt-6">
        <p className="eyebrow">Your dashboard</p>
        <h1 className="mt-3 font-serif text-4xl md:text-5xl">Watch your market, week by week.</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground leading-relaxed">
          Each scan stores what public sources show, then the next scan reports what actually changed — competitor
          prices, hours, reviews, and businesses that newly appear nearby.
        </p>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-start">
        {/* Left: profile */}
        <form onSubmit={onSaveProfile} className="paper-card rounded-md p-6 md:p-7 space-y-3" noValidate>
          <div>
            <p className="eyebrow">Your business</p>
            <h2 className="mt-1 font-serif text-2xl">Profile</h2>
          </div>
          <input
            className={input}
            name="businessName"
            required
            minLength={2}
            maxLength={120}
            placeholder="Business name"
            aria-label="Business name"
            value={profile.businessName}
            onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
          />
          <input
            className={input}
            name="location"
            required
            minLength={2}
            maxLength={160}
            placeholder="Neighbourhood, city (e.g. Shoreditch, London)"
            aria-label="Location"
            value={profile.location}
            onChange={(e) => setProfile({ ...profile, location: e.target.value })}
          />
          <select
            className={input}
            name="businessType"
            aria-label="Business type"
            value={profile.businessType}
            onChange={(e) => setProfile({ ...profile, businessType: e.target.value as BusinessType })}
          >
            {BUSINESS_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="w-full rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent sm:w-auto"
          >
            Save profile
          </button>
          {savedFlash && <p className="text-sm text-signal-green">Saved.</p>}
          {savedError && <p className="text-sm text-signal-red">{savedError}</p>}
          <p className="text-xs text-muted-foreground">
            Scans look up competitors, prices, reviews, and hours around this location.
          </p>
        </form>

        {/* Right: monitoring + generate + past briefs */}
        <div className="space-y-6">
          <MonitoringSummary status={status} latestChanges={latestChanges} genState={genState} />

          <div className="paper-card rounded-md p-6 md:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">Run a scan</p>
                <h2 className="mt-1 font-serif text-2xl">Generate your weekly brief</h2>
              </div>
              <button
                type="button"
                onClick={onGenerate}
                disabled={genState === "loading"}
                className="shrink-0 rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent disabled:opacity-60"
              >
                {genState === "loading" ? "Scanning live sources…" : "Run scan now"}
              </button>
            </div>
            {genError && <p className="mt-4 text-sm text-signal-red">{genError}</p>}
            <div className="mt-5" aria-live="polite">
              {latest ? (
                <BriefCard
                  title={latest.title}
                  signals={latest.signals as Signal[]}
                  recommendation={latest.recommendation}
                  why={latest.why}
                  dateLabel={`Live research · ${new Date(latest.capturedAt).toLocaleDateString()}`}
                  sources={latest.sources}
                  warnings={latest.warnings}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {genState === "loading"
                    ? "Checking listings, websites, and review evidence…"
                    : "Your brief will appear here after the first scan."}
                </p>
              )}
            </div>
          </div>

          <section>
            <p className="eyebrow">Past briefs</p>
            {briefs.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No briefs saved yet — your scanned briefs land here.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-rule border-t border-rule">
                {briefs.map((record) => (
                  <li key={record.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                      className="flex w-full items-baseline justify-between gap-4 py-3 text-left"
                    >
                      <span className="font-serif text-lg">{record.brief.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </span>
                    </button>
                    {expandedId === record.id && (
                      <div className="pb-5">
                        <BriefCard
                          title={record.brief.title}
                          signals={record.brief.signals as Signal[]}
                          recommendation={record.brief.recommendation}
                          why={record.brief.why}
                          dateLabel={new Date(record.createdAt).toLocaleDateString()}
                          sources={record.brief.sources}
                          warnings={record.brief.warnings}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </PageShell>
  );
}

function MonitoringSummary({
  status,
  latestChanges,
  genState,
}: {
  status: MonitoringStatus;
  latestChanges: DetectedChange[];
  genState: GenState;
}) {
  const changes = latestChanges.length > 0 ? latestChanges : status.changes;
  return (
    <div className="paper-card rounded-md p-6 md:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow">Monitoring</p>
          <h2 className="mt-1 font-serif text-2xl">What changed</h2>
        </div>
        {status.lastRunAt && (
          <p className="text-xs text-muted-foreground">
            Last scan: {new Date(status.lastRunAt).toLocaleDateString()} · {status.snapshotCount} scan
            {status.snapshotCount === 1 ? "" : "s"} stored
          </p>
        )}
      </div>
      {status.baseline && genState !== "loading" ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          No baseline yet. Run your first scan — it records today&apos;s market, and future scans report what
          changes against it. We never claim an opening or price move on a single look.
        </p>
      ) : changes.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {genState === "loading"
            ? "Scanning live sources…"
            : "No changes detected against the previous scan."}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {changes.map((change) => (
            <li key={`${change.kind}-${change.competitorName ?? ""}-${change.headline}`} className="flex gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[change.tone]}`} />
              <div>
                <p className="text-sm font-medium leading-snug">{change.headline}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{change.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const input =
  "w-full rounded-sm border border-input bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring";

function PageShell({ email, onSignOut, children }: { email: string; onSignOut: () => void; children: ReactNode }) {
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="font-serif text-2xl tracking-tight">
          Localscope<span className="text-accent">.</span>
        </Link>
        <div className="flex items-center gap-5 text-sm">
          {email && <span className="hidden text-muted-foreground sm:inline">{email}</span>}
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-sm border border-ink px-4 py-2 text-sm font-medium transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 pb-20">{children}</div>
    </main>
  );
}