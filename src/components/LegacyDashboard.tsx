import { Link, Navigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { BriefCard, type Signal } from "@/components/BriefCard";
import { AlertStrip, unacknowledgedAlertCount } from "@/components/AlertStrip";
import { MarketSnapshot } from "@/components/MarketSnapshot";
import { ConstellationGrid } from "@/components/ConstellationGrid";
import { AnimatedNavFramer, type AnimatedNavItem } from "@/components/ui/animated-nav-framer";
import { UpgradeOverlay } from "@/components/UpgradeOverlay";
import {
  getMonitoringStatus,
  getSchemaStatus,
  generateMonitoringBrief,
  listBriefs,
  type BriefRecord,
  type Business,
  type BusinessType,
  type MonitoringStatus,
  type Profile,
} from "@/lib/account.functions";
import { useBusinessManager } from "@/lib/use-business-manager";
import { listMarketAlerts, type MarketAlertRow } from "@/lib/alert.functions";
import type { Brief } from "@/lib/brief.functions";
import type { DetectedChange } from "@/lib/change-detection";

type ViewState = "checking" | "signedOut" | "setup" | "ready";
type GenState = "idle" | "loading" | "done" | "error";
type BusinessTab = "details" | "monitoring" | "scan";
type Screen = "business" | "add";

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
  analysis: null,
};

export function LegacyDashboard() {
  const router = useRouter();
  // Business data + mutations live in the shared manager (same instance of
  // the logic the globe dashboard uses) — this component only renders.
  const bm = useBusinessManager({ auto: false });
  const {
    businesses,
    activeId,
    activeBusiness,
    billing,
    tierGate,
    confirmDelete,
    armDelete,
    disarmDelete,
    add: addBusinessTo,
    save: saveBusinessTo,
    remove: removeBusiness,
    select: selectBusinessId,
    load: loadBusinesses,
  } = bm;
  const runMonitoring = useServerFn(generateMonitoringBrief);
  const fetchBriefs = useServerFn(listBriefs);
  const fetchStatus = useServerFn(getMonitoringStatus);
  const fetchAlerts = useServerFn(listMarketAlerts);
  const checkSchema = useServerFn(getSchemaStatus);

  const [view, setView] = useState<ViewState>("checking");
  const [screen, setScreen] = useState<Screen>("business");
  const [tab, setTab] = useState<BusinessTab>("monitoring");
  const [tabDir, setTabDir] = useState<"left" | "right" | null>(null);
  const [draft, setDraft] = useState<Profile>({
    businessName: "",
    businessType: "salon",
    location: "",
    pricePoint: "",
  });
  const [savedFlash, setSavedFlash] = useState(false);
  const [savedError, setSavedError] = useState("");
  const [addError, setAddError] = useState("");
  // Delete-in-flight state (the two-step confirm machine lives in the shared
  // manager; only the request status is local).
  const [deleteState, setDeleteState] = useState<"idle" | "deleting">("idle");
  const [deleteError, setDeleteError] = useState("");
  const [missingTables, setMissingTables] = useState<string[]>([]);

  const [status, setStatus] = useState<MonitoringStatus>(EMPTY_STATUS);
  const [briefs, setBriefs] = useState<BriefRecord[]>([]);
  const [alerts, setAlerts] = useState<MarketAlertRow[]>([]);
  const [latest, setLatest] = useState<Brief | null>(null);
  const [latestChanges, setLatestChanges] = useState<DetectedChange[]>([]);
  const [genState, setGenState] = useState<GenState>("idle");
  const [genError, setGenError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Plans / upgrade overlay — opened from the nav pill's Plans item.
  const [pricingOpen, setPricingOpen] = useState(false);

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
    try {
      // Schema probe first: if the setup migrations haven't been applied, show
      // a setup screen instead of letting save/scan fail with generic errors.
      const schema = await checkSchema();
      if (!schema.ok) {
        setMissingTables(schema.missingTables);
        setView("setup");
        return;
      }
      setMissingTables([]);

      // Shared manager loads businesses (with waitlist claim) + billing.
      const { businesses: resolved, billing: billingStatus } = await loadBusinesses();
      // Status/briefs are per-business — they load once the selection is known.
      const activeId0 = resolved[0]?.id ?? null;
      const briefsP = activeId0 ? fetchBriefs({ data: { businessId: activeId0 } }) : Promise.resolve({ briefs: [] as BriefRecord[] });
      const statusP = activeId0 ? fetchStatus({ data: { businessId: activeId0 } }) : Promise.resolve({ status: EMPTY_STATUS });
      const alertsP = activeId0
        ? fetchAlerts({ data: { unacknowledgedOnly: false, limit: 10 } })
        : Promise.resolve({ alerts: [] as MarketAlertRow[] });
      const [{ briefs: stored }, { status: monitoring }, { alerts: fetchedAlerts }] = await Promise.all([
        briefsP,
        statusP,
        alertsP,
      ]);
      const first = resolved[0];
      if (first) {
        setDraft({
          businessName: first.businessName,
          businessType: first.businessType,
          location: first.location,
          pricePoint: first.pricePoint ?? "",
        });
        setScreen("business");
        setTab("monitoring");
      } else {
        setScreen("add");
      }
      setBriefs(stored);
      setStatus(monitoring);
      setAlerts(fetchedAlerts);
      setView("ready");
      // No paid subscription — open the plans overlay once, after the screen
      // has settled. Dismissible; the dashboard stays fully usable.
      if (billingStatus && !billingStatus.accessGranted) setPricingOpen(true);
    } catch {
      // Token missing/expired — treat as signed out so the user can log in again.
      setView("signedOut");
    }
  }, [checkSchema, loadBusinesses, fetchBriefs, fetchStatus, fetchAlerts]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const railItemClass = (active: boolean) =>
    "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-sm px-3.5 py-2.5 text-sm font-medium transition-colors " +
    (active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground");

  // Tab switches slide in the direction you moved (spatial memory); every
  // other way of landing on a tab (business switch, first load) fades instead.
  function goTab(next: BusinessTab) {
    if (next === tab) return;
    const order: BusinessTab[] = ["details", "monitoring", "scan"];
    const from = order.indexOf(tab);
    const to = order.indexOf(next);
    setTabDir(to > from ? "right" : "left");
    setTab(next);
  }

  function selectBusiness(business: Business) {
    selectBusinessId(business.id);
    setDraft({
      businessName: business.businessName,
      businessType: business.businessType,
      location: business.location,
      pricePoint: business.pricePoint ?? "",
    });
    setScreen("business");
    setTab("monitoring");
    setTabDir(null);
    setSavedFlash(false);
    setSavedError("");
    setDeleteError("");
  }

  // Tier cap (shared with the globe dashboard + server-enforced): free = 0
  // new, Watch = 1, Advise = 5. With room left this opens the add form; at
  // the cap it points at plans.
  function onAddClick() {
    if (!tierGate.canAddMore) {
      setPricingOpen(true);
      return;
    }
    setDraft({ businessName: "", businessType: "salon", location: "", pricePoint: "" });
    setAddError("");
    setScreen("add");
  }

  async function onAddBusiness(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddError("");
    try {
      const created = await addBusinessTo(draft);
      setDraft({
        businessName: created.businessName,
        businessType: created.businessType,
        location: created.location,
        pricePoint: created.pricePoint ?? "",
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

  async function onDeleteBusiness() {
    if (!activeId) return;
    setDeleteState("deleting");
    setDeleteError("");
    try {
      const remaining = await removeBusiness(activeId);
      setDeleteState("idle");
      const next = remaining[0];
      if (next) {
        setDraft({
          businessName: next.businessName,
          businessType: next.businessType,
          location: next.location,
          pricePoint: next.pricePoint ?? "",
        });
        setScreen("business");
      } else {
        // None left: the add form when the tier allows it, plans otherwise.
        if (tierGate.limit > 0) {
          setDraft({ businessName: "", businessType: "salon", location: "", pricePoint: "" });
          setScreen("add");
        } else {
          setPricingOpen(true);
        }
      }
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete the business. Please try again.",
      );
      setDeleteState("idle");
    }
  }

  async function onSaveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavedFlash(false);
    setSavedError("");
    try {
      if (!activeId) return;
      await saveBusinessTo(activeId, draft);
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
      const res = await runMonitoring({ data: { businessId: activeBusiness.id } });
      if (!res.ok) {
        setGenError(res.error);
        setGenState("error");
        return;
      }
      setLatest(res.brief);
      setLatestChanges(res.changes);
      setGenState("done");
      const [{ briefs: refreshed }, { status: monitoring }, { alerts: fetchedAlerts }] = await Promise.all([
        fetchBriefs({ data: { businessId: activeBusiness.id } }),
        fetchStatus({ data: { businessId: activeBusiness.id } }),
        fetchAlerts({ data: { unacknowledgedOnly: false, limit: 10 } }),
      ]);
      setBriefs(refreshed);
      setStatus(monitoring);
      setAlerts(fetchedAlerts);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setGenState("error");
    }
  }

  async function onSignOut() {
    await supabase.auth.signOut();
    await router.navigate({ to: "/" });
  }

  // Nav pill items — same structure as the new dashboard: Business dropdown,
  // Plans (upgrade overlay), Profile, and Sign out (kept in the pill's auth
  // slot so it stays reachable on small screens where the collapsible pill
  // hides its items).
  const navItems: AnimatedNavItem[] = [
    {
      name: "Workspace",
      children: [
        { name: "Open workspace", href: "/app" },
        { name: "Competitors", href: "/app/competitors" },
        { name: "Compare", href: "/app/compare" },
        { name: "Briefs", href: "/app/briefs" },
        { name: "Market signals", href: "/app/market-signals" },
        { name: "Sources & alerts", href: "/app/sources" },
      ],
    },
    {
      name: "Business",
      children:
        businesses.length > 0
          ? businesses.map((b) => ({
              name: b.businessName || "Unnamed business",
              onClick: () => selectBusiness(b),
              active: b.id === activeId,
            }))
          : [{ name: "No businesses yet — add one with +" }],
    },
    { name: "Plans", onClick: () => setPricingOpen(true) },
    { name: "Profile", href: "/profile" },
  ];

  const changeCount = latestChanges.length > 0 ? latestChanges.length : status.changes.length;

  if (view === "checking") {
    return (
      <PageShell navItems={navItems} onSignOut={onSignOut}>
        Loading…
      </PageShell>
    );
  }
  if (view === "signedOut") {
    return <Navigate to="/login" />;
  }
  if (view === "setup") {
    return (
      <PageShell navItems={navItems} onSignOut={onSignOut}>
        <div className="mx-auto mt-16 max-w-xl">
          <div className="paper-card rounded-md p-8 text-center md:p-10">
            <p className="eyebrow">Setup required</p>
            <h1 className="mt-3 font-serif text-3xl">Your database isn&apos;t ready yet</h1>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
              theBizScope stores your profile, scans, and briefs in database tables that the setup
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
    <PageShell navItems={navItems} onSignOut={onSignOut}>
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
            <section className="space-y-8 animate-ls-fade" aria-label="Add a business">
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
                  Includes one business. Upgrade any time to watch more.
                </p>
              </form>
            </section>
          )}

          {screen === "business" && activeBusiness && (
            <div key={activeBusiness.id} className="space-y-8 animate-ls-fade">
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
                  onClick={() => goTab("scan")}
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
                        onClick={() => goTab(item.id)}
                        aria-current={active ? "page" : undefined}
                        className={
                          "flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 pb-3 pt-2 text-sm font-medium transition-colors " +
                          (active
                            ? "border-accent text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground")
                        }
                      >
                        {item.label}
                        {item.id === "monitoring" && changeCount + unacknowledgedAlertCount(alerts) > 0 && (
                          <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-signal-red px-1.5 text-[11px] font-semibold leading-none text-white">
                            {changeCount + unacknowledgedAlertCount(alerts)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              </div>

              <div
                key={tab + "-" + (tabDir ?? "none")}
                className={
                  tabDir === "right"
                    ? "animate-ls-from-right"
                    : tabDir === "left"
                      ? "animate-ls-from-left"
                      : ""
                }
              >
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
                  <input
                    className={input}
                    name="pricePoint"
                    maxLength={40}
                    placeholder="Your typical price (optional) — e.g. $45"
                    aria-label="Your typical price"
                    value={draft.pricePoint ?? ""}
                    onChange={(e) => setDraft({ ...draft, pricePoint: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional — lets your briefs rank your price against the local market.
                  </p>
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

                  {/* Danger zone — deletion also erases this business's scan
                      history and briefs, so it asks twice. */}
                  <div className="mt-5 rounded-md border border-signal-red/30 bg-signal-red-soft/30 p-4">
                    <p className="text-[10px] font-medium uppercase tracking-widest text-signal-red/80">
                      Danger zone
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      Removes this business with its scan history and briefs. Your other
                      businesses are unaffected.
                    </p>
                    {confirmDelete ? (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={onDeleteBusiness}
                          disabled={deleteState === "deleting"}
                          className="flex-1 rounded-sm bg-signal-red px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-signal-red/85 disabled:opacity-60"
                        >
                          {deleteState === "deleting" ? "Deleting…" : "Yes, delete permanently"}
                        </button>
                        <button
                          type="button"
                          onClick={disarmDelete}
                          className="rounded-sm border border-rule px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={armDelete}
                        className="mt-3 w-full rounded-sm border border-signal-red/40 px-3 py-2 text-xs font-medium text-signal-red transition-colors hover:bg-signal-red/10"
                      >
                        Delete this business
                      </button>
                    )}
                    {deleteError && <p className="mt-2 text-xs text-signal-red">{deleteError}</p>}
                  </div>
                </form>
              )}

              {tab === "monitoring" && (
                <div className="space-y-6">
                  <AlertStrip
                    alerts={alerts}
                    framed={false}
                    onChanged={() => {
                      void fetchAlerts({ data: { unacknowledgedOnly: false, limit: 10 } })
                        .then((result) => setAlerts(result.alerts))
                        .catch(() => {});
                    }}
                  />
                  {status.analysis && (
                    <section aria-label="Market snapshot" className="paper-card rounded-md p-6 md:p-7">
                      <p className="eyebrow">Market snapshot</p>
                      <MarketSnapshot analysis={status.analysis} className="mt-4" />
                    </section>
                  )}

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
                        onClick={() => goTab("scan")}
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
            </div>
          )}
        </main>
      </div>
      <UpgradeOverlay open={pricingOpen} onClose={() => setPricingOpen(false)} />
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

function PageShell({
  navItems,
  onSignOut,
  children,
}: {
  navItems: AnimatedNavItem[];
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <main className="theme-dark relative min-h-screen">
      {/* Same ink-and-constellation backdrop as the new dashboard — amber glow
          near the cursor, no globe warp. The fixed canvas matches the dark
          background, so the page reads as one continuous field. */}
      <ConstellationGrid className="fixed inset-0 h-screen w-full" warp={false} glowRadius={85} />

      {/* The same floating nav pill as the new dashboard — but collapsible,
          so it contracts into a small circle when the page scrolls down and
          springs back on scroll up (or on click). Sign out rides in the auth
          slot so it stays reachable on small screens. */}
      <AnimatedNavFramer
        logo={
          <Link to="/" className="whitespace-nowrap font-serif text-xl tracking-tight sm:text-2xl">
            theBizScope<span className="text-accent">.</span>
          </Link>
        }
        items={navItems}
        auth={
          <button
            type="button"
            onClick={onSignOut}
            className="px-2 py-1 text-sm font-medium text-signal-red transition-colors hover:text-signal-red/70"
          >
            Sign out
          </button>
        }
      />

      <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-24">{children}</div>
    </main>
  );
}