import { createFileRoute, Link, Navigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { BriefCard, type Signal } from "@/components/BriefCard";
import {
  claimWaitlistProfile,
  getMyProfile,
  getMonitoringStatus,
  getSchemaStatus,
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

type ViewState = "checking" | "signedOut" | "setup" | "ready";
type GenState = "idle" | "loading" | "done" | "error";
type Panel = "monitoring" | "business" | "scan";

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

const TABLE_LABELS: Record<string, string> = {
  profiles: "your business profile",
  monitoring_snapshots: "scan & change history",
};

const PANELS: Array<{ id: Panel; label: string }> = [
  { id: "monitoring", label: "Monitoring" },
  { id: "business", label: "Business" },
  { id: "scan", label: "Run scan" },
];

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
  const claimProfile = useServerFn(claimWaitlistProfile);
  const runMonitoring = useServerFn(generateMonitoringBrief);
  const fetchBriefs = useServerFn(listBriefs);
  const fetchStatus = useServerFn(getMonitoringStatus);
  const checkSchema = useServerFn(getSchemaStatus);

  const [view, setView] = useState<ViewState>("checking");
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<Profile>({ businessName: "", businessType: "salon", location: "" });
  const [savedFlash, setSavedFlash] = useState(false);
  const [savedError, setSavedError] = useState("");
  const [missingTables, setMissingTables] = useState<string[]>([]);

  const [status, setStatus] = useState<MonitoringStatus>(EMPTY_STATUS);
  const [briefs, setBriefs] = useState<BriefRecord[]>([]);
  const [latest, setLatest] = useState<Brief | null>(null);
  const [latestChanges, setLatestChanges] = useState<DetectedChange[]>([]);
  const [genState, setGenState] = useState<GenState>("idle");
  const [genError, setGenError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("monitoring");

  // Client-side auth gate: the session lives in browser storage, so SSR can't
  // see it. Server functions below are protected server-side too. Re-runnable
  // so the setup screen's "Re-check" can retry after migrations are applied.
  const loadDashboard = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session?.user) {
      setView("signedOut");
      return;
    }
    setEmail(session.user.email ?? "");
    try {
      // Schema probe first: if the setup migrations haven't been applied, show
      // a setup screen instead of letting save/scan fail with generic errors.
      const [schema, { profile: saved }, { briefs: stored }, { status: monitoring }] = await Promise.all([
        checkSchema(),
        getProfile(),
        fetchBriefs(),
        fetchStatus(),
      ]);
      if (!schema.ok) {
        setMissingTables(schema.missingTables);
        setView("setup");
        return;
      }
      setMissingTables([]);
      // No profile yet — if this email is on the waitlist, claim it and
      // prefill the profile so the dashboard starts populated.
      let resolvedProfile = saved;
      if (!resolvedProfile) {
        const claimed = await claimProfile();
        if (claimed.profile) resolvedProfile = claimed.profile;
      }
      if (resolvedProfile) setProfile(resolvedProfile);
      setBriefs(stored);
      setStatus(monitoring);
      setView("ready");
    } catch {
      // Token missing/expired — treat as signed out so the user can log in again.
      setView("signedOut");
    }
  }, [getProfile, fetchBriefs, fetchStatus, claimProfile, checkSchema]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

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

  const changeCount = latestChanges.length > 0 ? latestChanges.length : status.changes.length;

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
  if (view === "setup") {
    return (
      <PageShell email={email} onSignOut={onSignOut}>
        <div className="mx-auto mt-16 max-w-xl">
          <div className="paper-card rounded-md p-8 text-center md:p-10">
            <p className="eyebrow">Setup required</p>
            <h1 className="mt-3 font-serif text-3xl">Your database isn&apos;t ready yet</h1>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
              Localscope stores your profile, scans, and briefs in database tables that the setup
              migrations create. They haven&apos;t been applied yet, so saving your profile and running
              scans would fail.
            </p>
            <ul className="mx-auto mt-5 max-w-md space-y-1.5 text-left text-sm">
              {missingTables.map((table) => (
                <li key={table} className="flex items-start gap-2">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal-amber" />
                  <span>
                    Missing {TABLE_LABELS[table] ?? table} (
                    <code className="rounded-sm border border-rule bg-card px-1 py-0.5 font-mono text-xs">
                      {table}
                    </code>
                    )
                  </span>
                </li>
              ))}
            </ul>
            <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Apply the three SQL blocks in <code className="font-mono text-xs">SETUP.md</code> through the
              Supabase SQL Editor (project <code className="font-mono text-xs">gosbzrvxqwstzyhscufs</code>),
              then come back and re-check.
            </p>
            <button
              type="button"
              onClick={() => {
                setView("checking");
                void loadDashboard();
              }}
              className="mt-6 rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent"
            >
              Re-check
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell email={email} onSignOut={onSignOut}>
      <div className="pt-6 lg:flex lg:items-start lg:gap-12">
        {/* Section switcher: vertical rail on desktop, horizontal tabs on mobile */}
        <aside className="lg:sticky lg:top-8 lg:w-56 lg:shrink-0">
          <nav
            aria-label="Dashboard sections"
            className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:gap-2 lg:mx-0 lg:flex-col lg:px-0 lg:pb-0"
          >
            {PANELS.map((item) => {
              const active = panel === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPanel(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={
                    "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-sm px-3.5 py-2.5 text-sm font-medium transition-colors " +
                    (active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {item.label}
                  {item.id === "monitoring" && changeCount > 0 && (
                    <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-signal-red px-1.5 text-[11px] font-semibold leading-none text-white">
                      {changeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          {status.lastRunAt && (
            <p className="mt-4 hidden text-xs leading-relaxed text-muted-foreground lg:block">
              Last scan {new Date(status.lastRunAt).toLocaleDateString()} · {status.snapshotCount} scan
              {status.snapshotCount === 1 ? "" : "s"} stored
            </p>
          )}
        </aside>

        <main className="mt-8 min-w-0 flex-1 lg:mt-0">
          {panel === "monitoring" && (
            <section className="space-y-8" aria-label="Monitoring">
              <header>
                <p className="eyebrow">Market pulse</p>
                <h1 className="mt-2 font-serif text-3xl md:text-4xl">What changed near you</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Each scan stores what public sources show; the next one reports what actually moved —
                  competitor prices, hours, reviews, and businesses that newly appear nearby.
                </p>
              </header>

              <MonitoringSummary status={status} latestChanges={latestChanges} genState={genState} />

              {status.baseline && !latest && genState !== "loading" && (
                <div className="paper-card flex flex-col gap-4 rounded-md p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-serif text-xl">Start with a first scan</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      It records today&apos;s market as your baseline — nothing is reported on the first look.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPanel("scan")}
                    className="shrink-0 rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent"
                  >
                    Run your first scan
                  </button>
                </div>
              )}

              {latest && (
                <section aria-label="Latest brief">
                  <p className="eyebrow">Latest brief</p>
                  <div className="mt-3">
                    <BriefCard
                      title={latest.title}
                      signals={latest.signals as Signal[]}
                      recommendation={latest.recommendation}
                      why={latest.why}
                      dateLabel={"Live research · " + new Date(latest.capturedAt).toLocaleDateString()}
                      sources={latest.sources}
                      warnings={latest.warnings}
                    />
                  </div>
                </section>
              )}

              <section aria-label="Past briefs">
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
            </section>
          )}

          {panel === "business" && (
            <section className="space-y-8" aria-label="Business profile">
              <header>
                <p className="eyebrow">Business</p>
                <h1 className="mt-2 font-serif text-3xl md:text-4xl">Your profile</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Your business name, type, and neighbourhood anchor every scan and brief — competitors are
                  searched around this location.
                </p>
              </header>

              <form
                onSubmit={onSaveProfile}
                className="paper-card max-w-lg space-y-3 rounded-md p-6 md:p-7"
                noValidate
              >
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
                  className="w-full rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent"
                >
                  Save profile
                </button>
                {savedFlash && <p className="text-sm text-signal-green">Saved.</p>}
                {savedError && <p className="text-sm text-signal-red">{savedError}</p>}
              </form>
            </section>
          )}

          {panel === "scan" && (
            <section className="space-y-8" aria-label="Run a scan">
              <header>
                <p className="eyebrow">Run a scan</p>
                <h1 className="mt-2 font-serif text-3xl md:text-4xl">Generate your weekly brief</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  A fresh pass over live public sources — competitor prices, hours, ratings, and new
                  entrants — compared against your last scan, then written into a brief you can read in a minute.
                </p>
              </header>

              {!profile.businessName.trim() || !profile.location.trim() ? (
                <div className="paper-card flex flex-col gap-4 rounded-md p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-serif text-xl">Add your business first</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      Scans are anchored to your business name and neighbourhood — set those up in Business.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPanel("business")}
                    className="shrink-0 rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent"
                  >
                    Set up Business
                  </button>
                </div>
              ) : (
                <div className="paper-card rounded-md p-6 md:p-7">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="font-serif text-2xl">{profile.businessName}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {BUSINESS_TYPES.find((t) => t.value === profile.businessType)?.label} · {profile.location}
                      </p>
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
                  <p className="mt-4 text-xs text-muted-foreground">
                    The first scan sets your baseline; later scans report what changed against it. Your brief is
                    saved under Monitoring.
                  </p>
                  {genError && <p className="mt-4 text-sm text-signal-red">{genError}</p>}
                  <div className="mt-5" aria-live="polite">
                    {latest && genState === "done" ? (
                      <BriefCard
                        title={latest.title}
                        signals={latest.signals as Signal[]}
                        recommendation={latest.recommendation}
                        why={latest.why}
                        dateLabel={"Live research · " + new Date(latest.capturedAt).toLocaleDateString()}
                        sources={latest.sources}
                        warnings={latest.warnings}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {genState === "loading"
                          ? "Checking listings, websites, and review evidence…"
                          : "Your brief will appear here after the scan finishes."}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
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