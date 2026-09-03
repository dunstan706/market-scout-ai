import { createFileRoute, Link, Navigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { BriefCard, type Signal } from "@/components/BriefCard";
import {
  claimWaitlistProfile,
  createBusiness,
  listBusinesses,
  getMonitoringStatus,
  getSchemaStatus,
  generateMonitoringBrief,
  listBriefs,
  saveProfile,
  type BriefRecord,
  type Business,
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
type BusinessTab = "details" | "monitoring" | "scan";
type Screen = "business" | "add" | "plans";

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

const TABS: Array<{ id: BusinessTab; label: string }> = [
  { id: "details", label: "Details" },
  { id: "monitoring", label: "Monitoring" },
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
  const fetchBusinesses = useServerFn(listBusinesses);
  const persistProfile = useServerFn(saveProfile);
  const addBusiness = useServerFn(createBusiness);
  const claimProfile = useServerFn(claimWaitlistProfile);
  const runMonitoring = useServerFn(generateMonitoringBrief);
  const fetchBriefs = useServerFn(listBriefs);
  const fetchStatus = useServerFn(getMonitoringStatus);
  const checkSchema = useServerFn(getSchemaStatus);

  const [view, setView] = useState<ViewState>("checking");
  const [email, setEmail] = useState("");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("business");
  const [tab, setTab] = useState<BusinessTab>("monitoring");
  const [draft, setDraft] = useState<Profile>({ businessName: "", businessType: "salon", location: "" });
  const [savedFlash, setSavedFlash] = useState(false);
  const [savedError, setSavedError] = useState("");
  const [addError, setAddError] = useState("");
  const [missingTables, setMissingTables] = useState<string[]>([]);

  const [status, setStatus] = useState<MonitoringStatus>(EMPTY_STATUS);
  const [briefs, setBriefs] = useState<BriefRecord[]>([]);
  const [latest, setLatest] = useState<Brief | null>(null);
  const [latestChanges, setLatestChanges] = useState<DetectedChange[]>([]);
  const [genState, setGenState] = useState<GenState>("idle");
  const [genError, setGenError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      const [schema, { businesses: owned }, { briefs: stored }, { status: monitoring }] = await Promise.all([
        checkSchema(),
        fetchBusinesses(),
        fetchBriefs(),
        fetchStatus(),
      ]);
      if (!schema.ok) {
        setMissingTables(schema.missingTables);
        setView("setup");
        return;
      }
      setMissingTables([]);
      let resolved = owned;
      // No business yet — if this email is on the waitlist, claim it and
      // prefill a business so the dashboard starts populated.
      if (resolved.length === 0) {
        const claimed = await claimProfile();
        if (claimed.profile) {
          resolved = [
            {
              id: session.user.id,
              businessName: claimed.profile.businessName,
              businessType: claimed.profile.businessType,
              location: claimed.profile.location,
            },
          ];
        }
      }
      setBusinesses(resolved);
      const first = resolved[0];
      if (first) {
        setActiveId(first.id);
        setDraft({
          businessName: first.businessName,
          businessType: first.businessType,
          location: first.location,
        });
        setScreen("business");
        setTab("monitoring");
      } else {
        setActiveId(null);
        setScreen("add");
      }
      setBriefs(stored);
      setStatus(monitoring);
      setView("ready");
    } catch {
      // Token missing/expired — treat as signed out so the user can log in again.
      setView("signedOut");
    }
  }, [checkSchema, fetchBusinesses, fetchBriefs, fetchStatus, claimProfile]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const activeBusiness = businesses.find((b) => b.id === activeId) ?? null;
  const railItemClass = (active: boolean) =>
    "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-sm px-3.5 py-2.5 text-sm font-medium transition-colors " +
    (active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground");

  function selectBusiness(business: Business) {
    setActiveId(business.id);
    setDraft({
      businessName: business.businessName,
      businessType: business.businessType,
      location: business.location,
    });
    setScreen("business");
    setTab("monitoring");
    setSavedFlash(false);
    setSavedError("");
  }

  // Free tier = 1 business: with none yet this opens the add form; with one
  // already saved it points at the plans screen (the real upgrade page ships
  // later with billing).
  function onAddClick() {
    if (businesses.length === 0) {
      setDraft({ businessName: "", businessType: "salon", location: "" });
      setAddError("");
      setScreen("add");
      return;
    }
    setScreen("plans");
  }

  async function onAddBusiness(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddError("");
    try {
      const { business } = await addBusiness({ data: draft });
      setBusinesses([business]);
      setActiveId(business.id);
      setDraft({
        businessName: business.businessName,
        businessType: business.businessType,
        location: business.location,
      });
      setScreen("business");
      setTab("monitoring");
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Could not add your business. Please try again.";
      console.error(err);
      setAddError(message);
    }
  }

  async function onSaveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavedFlash(false);
    setSavedError("");
    try {
      await persistProfile({ data: draft });
      setBusinesses((prev) =>
        prev.map((b) =>
          b.id === activeId
            ? {
                ...b,
                businessName: draft.businessName,
                businessType: draft.businessType,
                location: draft.location,
              }
            : b,
        ),
      );
      setSavedFlash(true);
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Could not save your profile. Please try again.";
      console.error(err);
      setSavedError(message);
    }
  }

  async function onGenerate() {
    if (!activeBusiness || !activeBusiness.businessName.trim() || !activeBusiness.location.trim()) {
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
      <div className="pt-6 lg:flex lg:items-start lg:gap-10">
        {/* Business rail */}
        <aside className="lg:sticky lg:top-8 lg:w-60 lg:shrink-0">
          <p className="hidden text-xs font-medium uppercase tracking-widest text-muted-foreground lg:block">
            Your businesses
          </p>
          <nav
            aria-label="Your businesses"
            className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-1 sm:gap-2 lg:mx-0 lg:flex-col lg:px-0 lg:pb-0"
          >
            {businesses.length === 0 ? (
              <button type="button" onClick={onAddClick} className={railItemClass(true)}>
                Add a new Business
              </button>
            ) : (
              businesses.map((business) => (
                <button
                  key={business.id}
                  type="button"
                  onClick={() => selectBusiness(business)}
                  aria-current={business.id === activeId ? "page" : undefined}
                  className={railItemClass(business.id === activeId)}
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {business.businessName || "Unnamed business"}
                  </span>
                </button>
              ))
            )}
          </nav>
          {businesses.length > 0 && (
            <button
              type="button"
              onClick={onAddClick}
              className="mt-2 flex w-full shrink-0 items-center gap-1.5 rounded-sm border border-dashed border-rule px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
            >
              <span aria-hidden="true">+</span> Add a new Business
            </button>
          )}
          {businesses.length > 0 && status.lastRunAt && (
            <p className="mt-4 hidden text-xs leading-relaxed text-muted-foreground lg:block">
              Last scan {new Date(status.lastRunAt).toLocaleDateString()} · {status.snapshotCount} scan
              {status.snapshotCount === 1 ? "" : "s"} stored
            </p>
          )}
        </aside>

        <main className="mt-8 min-w-0 flex-1 lg:mt-0">
          {screen === "add" && (
            <section className="space-y-8" aria-label="Add a business">
              <header>
                <p className="eyebrow">Getting started</p>
                <h1 className="mt-2 font-serif text-3xl md:text-4xl">Add your first business</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Tell us which business to watch — its name, type, and neighbourhood anchor every scan and brief.
                </p>
              </header>

              <form
                onSubmit={onAddBusiness}
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
                  value={draft.businessName}
                  onChange={(e) => setDraft({ ...draft, businessName: e.target.value })}
                />
                <input
                  className={input}
                  name="location"
                  required
                  minLength={2}
                  maxLength={160}
                  placeholder="Neighbourhood, city (e.g. Shoreditch, London)"
                  aria-label="Location"
                  value={draft.location}
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                />
                <select
                  className={input}
                  name="businessType"
                  aria-label="Business type"
                  value={draft.businessType}
                  onChange={(e) => setDraft({ ...draft, businessType: e.target.value as BusinessType })}
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
                  Add business
                </button>
                {addError && <p className="text-sm text-signal-red">{addError}</p>}
                <p className="text-xs text-muted-foreground">
                  The free plan includes one business. Paid plans (coming soon) let you watch more.
                </p>
              </form>
            </section>
          )}

          {screen === "plans" && (
            <section className="space-y-8" aria-label="Plans">
              <header>
                <p className="eyebrow">Plans</p>
                <h1 className="mt-2 font-serif text-3xl md:text-4xl">More businesses are coming</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Watching multiple businesses is part of our paid plans. Your free account includes one — here
                  is what is planned.
                </p>
              </header>

              <ul className="paper-card max-w-lg divide-y divide-rule rounded-md p-2 md:p-3">
                <li className="flex items-baseline justify-between gap-4 px-4 py-3.5">
                  <div>
                    <p className="font-serif text-lg">Starter</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">One business — what you have today</p>
                  </div>
                  <p className="shrink-0 text-sm font-medium">$15/mo</p>
                </li>
                <li className="flex items-baseline justify-between gap-4 px-4 py-3.5">
                  <div>
                    <p className="font-serif text-lg">Pro</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">Up to five businesses</p>
                  </div>
                  <p className="shrink-0 text-sm font-medium">$50/mo</p>
                </li>
                <li className="flex items-baseline justify-between gap-4 px-4 py-3.5">
                  <div>
                    <p className="font-serif text-lg">Enterprise</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">Unlimited businesses</p>
                  </div>
                  <p className="shrink-0 text-sm font-medium">Ask for a quote</p>
                </li>
              </ul>
              <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
                Billing is not open yet — we&apos;ll let you know when it is. Until then, the free plan covers one
                business.
              </p>
            </section>
          )}

          {screen === "business" && activeBusiness && (
            <div className="space-y-8">
              <header className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="eyebrow">Business</p>
                  <h1 className="mt-2 font-serif text-3xl md:text-4xl">
                    {activeBusiness.businessName || "Your business"}
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {BUSINESS_TYPES.find((t) => t.value === activeBusiness.businessType)?.label} ·{" "}
                    {activeBusiness.location || "No location set"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTab("scan")}
                  className="shrink-0 rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent"
                >
                  Run scan now
                </button>
              </header>

              <div className="border-b border-rule">
                <nav aria-label="Business views" className="-mb-px flex gap-1 overflow-x-auto">
                  {TABS.map((item) => {
                    const active = tab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTab(item.id)}
                        aria-current={active ? "page" : undefined}
                        className={
                          "flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 pb-3 pt-2 text-sm font-medium transition-colors " +
                          (active
                            ? "border-accent text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground")
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
              </div>

              {tab === "details" && (
                <form
                  onSubmit={onSaveDetails}
                  className="paper-card max-w-lg space-y-3 rounded-md p-6 md:p-7"
                  noValidate
                >
                  <div>
                    <p className="eyebrow">Details</p>
                    <h2 className="mt-1 font-serif text-2xl">About this business</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Used to anchor every scan and brief — competitors are searched around this location.
                    </p>
                  </div>
                  <input
                    className={input}
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
                    className={input}
                    name="location"
                    required
                    minLength={2}
                    maxLength={160}
                    placeholder="Neighbourhood, city (e.g. Shoreditch, London)"
                    aria-label="Location"
                    value={draft.location}
                    onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                  />
                  <select
                    className={input}
                    name="businessType"
                    aria-label="Business type"
                    value={draft.businessType}
                    onChange={(e) => setDraft({ ...draft, businessType: e.target.value as BusinessType })}
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
                    Save details
                  </button>
                  {savedFlash && <p className="text-sm text-signal-green">Saved.</p>}
                  {savedError && <p className="text-sm text-signal-red">{savedError}</p>}
                </form>
              )}

              {tab === "monitoring" && (
                <div className="space-y-6">
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
                        onClick={() => setTab("scan")}
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
                </div>
              )}

              {tab === "scan" && (
                <div className="space-y-6">
                  <div className="paper-card rounded-md p-6 md:p-7">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="eyebrow">Run a scan</p>
                        <h2 className="mt-1 font-serif text-2xl">Generate your weekly brief</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                          A fresh pass over live public sources — competitor prices, hours, ratings, and new
                          entrants — compared against your last scan, then written into a brief.
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
                      The first scan sets your baseline; later scans report what changed against it.
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
                </div>
              )}
            </div>
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