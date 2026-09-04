import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Expand, Plus, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { BriefCard, type Signal } from "@/components/BriefCard";
import { GlobeScene, type GlobeState } from "@/components/GlobeScene";
import { AnimatedNavFramer, type AnimatedNavItem } from "@/components/ui/animated-nav-framer";
import { ConstellationGrid } from "@/components/ConstellationGrid";
import {
  claimWaitlistProfile,
  createBusiness,
  generateMonitoringBrief,
  getMonitoringStatus,
  listBriefs,
  listBusinesses,
  saveProfile,
  type BriefRecord,
  type Business,
  type BusinessType,
  type MonitoringStatus,
  type Profile,
} from "@/lib/account.functions";
import type { Brief } from "@/lib/brief.functions";
import type { DetectedChange } from "@/lib/change-detection";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboardtest")({
  head: () => ({
    meta: [
      { title: "Localscope" },
      { robots: "noindex" },
    ],
  }),
  component: DashboardTestPage,
});

const BUSINESS_TYPES: Array<{ value: BusinessType; label: string }> = [
  { value: "salon", label: "Salon" },
  { value: "spa", label: "Spa" },
  { value: "other", label: "Other" },
];

type AddState = "idle" | "saving" | "error";
type GenState = "idle" | "loading" | "done" | "error";
type ScanTab = "details" | "monitoring" | "scan";

const SCAN_TABS: Array<{ id: ScanTab; label: string }> = [
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

const TONE_DOT: Record<DetectedChange["tone"], string> = {
  red: "bg-signal-red",
  amber: "bg-signal-amber",
  green: "bg-signal-green",
};

function DashboardTestPage() {
  const router = useRouter();
  const addBusiness = useServerFn(createBusiness);
  const fetchBusinesses = useServerFn(listBusinesses);
  const claimProfile = useServerFn(claimWaitlistProfile);
  const persistProfile = useServerFn(saveProfile);
  const fetchStatus = useServerFn(getMonitoringStatus);
  const fetchBriefs = useServerFn(listBriefs);
  const runMonitoring = useServerFn(generateMonitoringBrief);
  // Shared, live globe state: GlobeScene writes its center + limb radius here
  // every frame, and the constellation reads it for the warp — same document,
  // so no iframe and no postMessage.
  const fallbackHalf =
    typeof window === "undefined"
      ? 200
      : Math.min(window.innerHeight * 0.8, window.innerWidth * 0.8) / 2;
  const globeStateRef = useRef<GlobeState>({
    cx: 0,
    cy: 0,
    radius: fallbackHalf * 0.318,
    markX: 0,
    markY: 0,
    markVisible: false,
  });
  // Incrementing this tells the globe to play its reveal sequence.
  const revealTriggerRef = useRef(0);
  // Incrementing this asks the globe to rotate so the mark faces the front
  // again (when a business is selected from the nav dropdown).
  const focusTriggerRef = useRef(0);

  // Add-a-business overlay state.
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{
    businessName: string;
    businessType: BusinessType;
    location: string;
  }>({ businessName: "", businessType: "salon", location: "" });
  const [addState, setAddState] = useState<AddState>("idle");
  const [addError, setAddError] = useState("");

  // The "run a scan" callout box: wanted after a business is added or when the
  // amber mark is clicked. While it is open the globe holds still; dismissing
  // it lets the globe spin at its idle speed again until the mark is clicked.
  const [scanOpen, setScanOpen] = useState(false);
  const scanOpenRef = useRef(scanOpen);
  useEffect(() => {
    scanOpenRef.current = scanOpen;
  }, [scanOpen]);

  // Businesses synced from the shared profiles table (what the old dashboard
  // writes). Empty until the check finishes — the globe only mounts once this
  // settles, so it starts in the right state (mark present or pristine).
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Expanded run-a-scan panel: Details / Monitoring / Run scan. While
  // expanded it replaces the small callout below the mark.
  const [expanded, setExpanded] = useState(false);
  const [scanTab, setScanTab] = useState<ScanTab>("details");
  const [tabDir, setTabDir] = useState<"left" | "right" | null>(null);

  const [detailDraft, setDetailDraft] = useState<Profile>({
    businessName: "",
    businessType: "salon",
    location: "",
  });
  const [savedFlash, setSavedFlash] = useState(false);
  const [savedError, setSavedError] = useState("");

  const [status, setStatus] = useState<MonitoringStatus>(EMPTY_STATUS);
  const [briefs, setBriefs] = useState<BriefRecord[]>([]);
  const [latest, setLatest] = useState<Brief | null>(null);
  const [latestChanges, setLatestChanges] = useState<DetectedChange[]>([]);
  const [genState, setGenState] = useState<GenState>("idle");
  const [genError, setGenError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session?.user) {
        setAuthChecked(true);
        return;
      }
      try {
        const { businesses } = await fetchBusinesses();
        let resolved = businesses;
        // No business yet — if this email signed up for the waitlist, claim it
        // and prefill, exactly like the old dashboard does.
        if (resolved.length === 0) {
          const claimed = await claimProfile();
          if (claimed.profile) {
            resolved = [
              {
                id: data.session.user.id,
                businessName: claimed.profile.businessName,
                businessType: claimed.profile.businessType,
                location: claimed.profile.location,
              },
            ];
          }
        }
        if (cancelled) return;
        setBusinesses(resolved);
        const first = resolved[0];
        if (first) {
          setActiveId(first.id);
          setScanOpen(true); // mark + box up immediately
        }
      } catch {
        // Signed-out, expired, or schema not ready — leave the globe pristine.
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchBusinesses, claimProfile]);

  // Outside-click dismissal: only while the box is actually up (the reveal
  // sweep may still be playing, or the mark may be behind the sphere).
  useEffect(() => {
    if (!scanOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const box = boxRef.current;
      if (!box || box.dataset["open"] !== "1") return;
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest("[data-scan-box], button, a, input, textarea, select, [role]")
      )
        return;
      setScanOpen(false);
      setExpanded(false); // an outside press collapses the expanded panel too
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [scanOpen]);

  // Dev aids: expose the live warp radius and a reveal trigger for verification.
  useEffect(() => {
    const id = setInterval(() => {
      const main = document.querySelector("main");
      const s = globeStateRef.current;
      main?.setAttribute("data-warp-radius", String(Math.round(s.radius)));
      main?.setAttribute("data-mark", s.markVisible ? "1" : "0");
      main?.setAttribute("data-mark-x", String(Math.round(s.markX)));
      main?.setAttribute("data-mark-y", String(Math.round(s.markY)));
    }, 300);
    const w = window as unknown as Record<string, unknown>;
    w["__reveal"] = () => {
      revealTriggerRef.current += 1;
    };
    w["__focus"] = () => {
      focusTriggerRef.current += 1;
    };
    return () => {
      clearInterval(id);
      delete w["__reveal"];
      delete w["__focus"];
    };
  }, []);

  // The "run a scan" callout box rides below the globe's mark, following its
  // live screen position every frame. It is only shown while the panel is
  // wanted AND the mark is on the visible front of the sphere; the box is
  // interactive (data-open="1") exactly when it is shown, so a click outside
  // dismisses it while the globe is holding still under it.
  const activeBusiness = businesses.find((b) => b.id === activeId) ?? businesses[0] ?? null;
  const changeCount = latestChanges.length > 0 ? latestChanges.length : status.changes.length;

  // Load monitoring status + stored briefs whenever the panel expands.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void (async () => {
      try {
        const [{ status: monitoring }, { briefs: stored }] = await Promise.all([
          fetchStatus(),
          fetchBriefs(),
        ]);
        if (cancelled) return;
        setStatus(monitoring);
        setBriefs(stored);
      } catch {
        // Signed out or schema not ready — the tabs render their empty states.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, fetchStatus, fetchBriefs]);

  // Seed the details form whenever the active business changes.
  useEffect(() => {
    if (!activeBusiness) return;
    setDetailDraft({
      businessName: activeBusiness.businessName,
      businessType: activeBusiness.businessType,
      location: activeBusiness.location,
    });
  }, [activeBusiness?.id]);

  // Selecting a business from the nav dropdown: the globe rotates to bring its
  // mark to the front, and the run-a-scan box opens once it arrives.
  function selectBusiness(business: Business) {
    setActiveId(business.id);
    setScanOpen(true);
    setExpanded(false);
    focusTriggerRef.current += 1;
  }

  // The nav "Business" dropdown lists every synced business; picking one
  // selects it (the globe rotates to it and the scan box opens).
  const businessMenuItems: AnimatedNavItem[] =
    businesses.length > 0
      ? businesses.map((b) => ({
          name: b.businessName || "Unnamed business",
          onClick: () => selectBusiness(b),
          active: b.id === activeId,
        }))
      : [{ name: "No businesses yet — add one with +" }];

  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let raf = 0;
    let wasVisible = false;
    const tick = () => {
      const s = globeStateRef.current;
      const box = boxRef.current;
      if (box) {
        const shown = scanOpenRef.current && s.markVisible && s.markY > 0;
        box.dataset["open"] = shown ? "1" : "0";
        if (shown) {
          const bw = box.offsetWidth || 232;
          const bh = box.offsetHeight || 120;
          let left = s.markX - bw / 2;
          let top = s.markY + 26;
          left = Math.max(8, Math.min(window.innerWidth - 8 - bw, left));
          top = Math.max(8, Math.min(window.innerHeight - 8 - bh, top));
          box.style.left = `${left}px`;
          box.style.top = `${top}px`;
          box.style.opacity = "1";
          box.style.pointerEvents = "auto";
          if (!wasVisible) {
            box.classList.remove("animate-rise");
            void box.offsetWidth; // restart the entrance animation
            box.classList.add("animate-rise");
            wasVisible = true;
          }
        } else {
          wasVisible = false;
          /* animate-rise holds its end state (fill both), which would keep
             opacity pinned at 1 and override the inline fade — drop it so the
             box fades out and replays its entrance next time it opens. */
          box.classList.remove("animate-rise");
          box.style.opacity = "0";
          box.style.pointerEvents = "none";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  async function onSignOut() {
    await supabase.auth.signOut();
    await router.navigate({ to: "/" });
  }

  function openAdd() {
    setDraft({ businessName: "", businessType: "salon", location: "" });
    setAddState("idle");
    setAddError("");
    setAdding(true);
  }
  function closeAdd() {
    setAdding(false);
  }

  async function onSubmitAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddState("saving");
    setAddError("");
    try {
      const { business: created } = await addBusiness({ data: draft });
      setBusinesses([created]); // now in sync with the old dashboard's profiles
      setActiveId(created.id);
      // First business created — close the panel and let the globe play its
      // reveal: one fast full turn, the type fades to a plain dotted field,
      // and the mark pops onto the front.
      closeAdd();
      revealTriggerRef.current += 1;
      setScanOpen(true); // the box appears once the mark pops onto the front
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Could not add your business. Please try again.";
      console.error(err);
      setAddError(message);
      setAddState("error");
    }
  }

  // Collapse/close helpers for the run-a-scan callout. The X on either the
  // small box or the expanded panel returns to the globe entirely.
  function closeScan() {
    setScanOpen(false);
    setExpanded(false);
    setSavedFlash(false);
    setSavedError("");
  }

  // Tab switches slide in the direction you moved (spatial memory); landing on
  // a tab any other way fades instead.
  function goScanTab(next: ScanTab) {
    if (next === scanTab) return;
    const order: ScanTab[] = ["details", "monitoring", "scan"];
    setTabDir(order.indexOf(next) > order.indexOf(scanTab) ? "right" : "left");
    setScanTab(next);
  }

  async function onSaveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavedFlash(false);
    setSavedError("");
    try {
      await persistProfile({ data: detailDraft });
      if (activeBusiness) {
        setBusinesses((prev) =>
          prev.map((b) => (b.id === activeBusiness.id ? { ...b, ...detailDraft } : b)),
        );
      }
      setSavedFlash(true);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Could not save your business details.";
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
      const [{ status: monitoring }, { briefs: stored }] = await Promise.all([
        fetchStatus(),
        fetchBriefs(),
      ]);
      setStatus(monitoring);
      setBriefs(stored);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setGenState("error");
    }
  }

  return (
    <main className="theme-dark relative h-screen w-full overflow-hidden">
      {/* Page-wide constellation — lights up amber near the cursor (small
          radius), and warps around the globe's limb instead of the cursor.
          The warp tracks the sphere radius the globe writes live. */}
      <ConstellationGrid
        className="fixed inset-0 h-screen w-full"
        warp={false}
        glowRadius={85}
        globeWarp
        globeStateRef={globeStateRef}
      />

      {/* The globe, drawn directly on the page (no iframe). A full-viewport
          canvas that is transparent everywhere outside the sphere's disc, so
          the starfield shows through all around it — and since the canvas is
          as big as the screen, the disc can never be clipped by a square.
          Interactions (drag/zoom) are handled at the window level. */}
      {authChecked && (
        <GlobeScene
          stateRef={globeStateRef}
          revealTriggerRef={revealTriggerRef}
          focusTriggerRef={focusTriggerRef}
        holdStill={scanOpen}
        onMarkClick={() => {
          setScanOpen(true);
          setExpanded(false); // pressing the mark returns to the small box
        }}
        startRevealed={businesses.length > 0}
          className="fixed inset-0 h-screen w-full"
        />
      )}

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
          { name: "Plans", href: "/dashboard" },
          { name: "Profile", href: "/dashboard" },
          { name: "Sign out", onClick: onSignOut, danger: true },
        ]}
      />

      {/* Add-business pill — expands into the add-a-business panel. The icon
          rotates into an × while the panel is open, and the pill stays above
          the overlay so it doubles as the close button. */}
      <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
        <button
          type="button"
          aria-label={adding ? "Close add a business" : "Add a business"}
          aria-expanded={adding}
          onClick={() => (adding ? closeAdd() : openAdd())}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-rule bg-background/80 text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          <Plus
            className={`h-5 w-5 transition-transform duration-300 ${adding ? "rotate-45" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Callout box below the globe's mark. Small by default: a dismiss X on
          its left and an expand handle top-right, with the synced business in
          the body. Clicking expand swaps it for the full Details / Monitoring
          / Run scan panel; the X on either returns to the globe (outside
          clicks dismiss too). Pressing the amber mark re-opens it. */}
      <div
        ref={boxRef}
        data-scan-box
        className={cn(
          "fixed left-0 top-0 z-40 rounded-md border border-rule bg-background/90 opacity-0 shadow-lift backdrop-blur-sm",
          expanded ? "w-[400px] max-w-[92vw]" : "w-[232px]",
        )}
        style={{
          left: "-1000px",
          top: "-1000px",
          transition: "opacity 0.35s ease, width 0.2s ease",
        }}
      >
        {expanded ? (
          <div className="flex max-h-[min(72vh,560px)] flex-col">
            {/* header: close (returns to the globe) + business name */}
            <div className="flex items-center gap-1 border-b border-rule py-1.5 pl-2 pr-2.5">
              <button
                type="button"
                aria-label="Close run a scan"
                onClick={closeScan}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-rule/60 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="flex-1 truncate pr-2 text-center text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                {activeBusiness?.businessName || "Run a scan"}
              </span>
              <Expand className="h-3.5 w-3.5 text-muted-foreground/40" aria-hidden="true" />
            </div>

            {/* tabs */}
            <div className="flex gap-1 border-b border-rule px-2">
              {SCAN_TABS.map((tab) => {
                const active = scanTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => goScanTab(tab.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-2.5 text-xs font-medium transition-colors",
                      active
                        ? "border-accent text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.label}
                    {tab.id === "monitoring" && changeCount > 0 && (
                      <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-signal-red px-1 text-[10px] font-semibold leading-none text-white">
                        {changeCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* tab content */}
            <div
              key={scanTab + "-" + (tabDir ?? "none")}
              className={cn(
                "overflow-y-auto",
                tabDir === "right"
                  ? "animate-ls-from-right"
                  : tabDir === "left"
                    ? "animate-ls-from-left"
                    : "",
              )}
            >
              {scanTab === "details" && (
                <form onSubmit={onSaveDetails} className="space-y-2.5 p-4" noValidate>
                  <p className="eyebrow">Details</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Anchors every scan — competitors are searched around this location.
                  </p>
                  <input
                    className={inputCls}
                    name="businessName"
                    required
                    minLength={2}
                    maxLength={120}
                    placeholder="Business name"
                    aria-label="Business name"
                    value={detailDraft.businessName}
                    onChange={(e) =>
                      setDetailDraft({ ...detailDraft, businessName: e.target.value })
                    }
                  />
                  <input
                    className={inputCls}
                    name="location"
                    required
                    minLength={2}
                    maxLength={160}
                    placeholder="Neighbourhood, city"
                    aria-label="Location"
                    value={detailDraft.location}
                    onChange={(e) =>
                      setDetailDraft({ ...detailDraft, location: e.target.value })
                    }
                  />
                  <select
                    className={inputCls}
                    name="businessType"
                    aria-label="Business type"
                    value={detailDraft.businessType}
                    onChange={(e) =>
                      setDetailDraft({
                        ...detailDraft,
                        businessType: e.target.value as BusinessType,
                      })
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
                    className="w-full rounded-sm bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent"
                  >
                    Save details
                  </button>
                  {savedFlash && <p className="text-sm text-signal-green">Saved.</p>}
                  {savedError && <p className="text-sm text-signal-red">{savedError}</p>}
                </form>
              )}

              {scanTab === "monitoring" && (
                <div className="space-y-4 p-4">
                  <p className="eyebrow">Monitoring</p>
                  {status.lastRunAt ? (
                    <p className="text-xs text-muted-foreground">
                      Last scan {new Date(status.lastRunAt).toLocaleDateString()} ·{" "}
                      {status.snapshotCount} scan{status.snapshotCount === 1 ? "" : "s"} stored
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No scans yet — your first scan records today&apos;s market as the baseline.
                    </p>
                  )}
                  {changeCount === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {genState === "loading"
                        ? "Scanning live sources…"
                        : "No changes detected against the previous scan."}
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {(latestChanges.length > 0 ? latestChanges : status.changes).map((change) => (
                        <li
                          key={`${change.kind}-${change.competitorName ?? ""}-${change.headline}`}
                          className="flex gap-2.5"
                        >
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[change.tone]}`}
                          />
                          <div>
                            <p className="text-xs font-medium leading-snug">{change.headline}</p>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                              {change.detail}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {briefs.length > 0 && (
                    <div>
                      <p className="eyebrow">Past briefs</p>
                      <div className="mt-2">
                        <BriefCard
                          title={briefs[0]!.brief.title}
                          signals={briefs[0]!.brief.signals as Signal[]}
                          recommendation={briefs[0]!.brief.recommendation}
                          why={briefs[0]!.brief.why}
                          dateLabel={new Date(briefs[0]!.createdAt).toLocaleDateString()}
                          sources={briefs[0]!.brief.sources}
                          warnings={briefs[0]!.brief.warnings}
                        />
                      </div>
                      {briefs.length > 1 && (
                        <ul className="mt-3 divide-y divide-rule border-t border-rule">
                          {briefs.slice(1).map((record) => (
                            <li key={record.id} className="py-2">
                              <p className="truncate font-serif text-sm">{record.brief.title}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {new Date(record.createdAt).toLocaleDateString()}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {scanTab === "scan" && (
                <div className="space-y-3 p-4">
                  <p className="eyebrow">Run a scan</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    A fresh pass over live public sources — competitor prices, hours, ratings and
                    new entrants — compared against your last scan, then written into a brief.
                  </p>
                  <button
                    type="button"
                    onClick={onGenerate}
                    disabled={genState === "loading"}
                    className="w-full rounded-sm bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    {genState === "loading" ? "Scanning live sources…" : "Run scan now"}
                  </button>
                  {genError && <p className="text-sm text-signal-red">{genError}</p>}
                  {latest && genState === "done" ? (
                    <BriefCard
                      title={latest.title}
                      signals={latest.signals as Signal[]}
                      recommendation={latest.recommendation}
                      why={latest.why}
                      dateLabel={
                        "Live research · " + new Date(latest.capturedAt).toLocaleDateString()
                      }
                      sources={latest.sources}
                      warnings={latest.warnings}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {genState === "loading"
                        ? "Checking listings, websites, and review evidence…"
                        : "Your brief will appear here after the scan finishes."}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 border-b border-rule py-1.5 pl-2 pr-2.5">
              <button
                type="button"
                aria-label="Close run a scan"
                onClick={closeScan}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-rule/60 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="flex-1 pr-2 text-center text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Run a scan
              </span>
              <button
                type="button"
                aria-label="Expand run a scan"
                onClick={() => setExpanded(true)}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-rule/60 hover:text-foreground"
              >
                <Expand className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="px-3.5 py-3">
              {activeBusiness ? (
                <>
                  <p className="truncate font-serif text-sm leading-snug text-foreground">
                    {activeBusiness.businessName}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {BUSINESS_TYPES.find((t) => t.value === activeBusiness.businessType)?.label ??
                      "Business"}{" "}
                    · {activeBusiness.location || "No location set"}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Your business appears here after you add it.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Add-a-business overlay — rises over the globe like the auth card and
          landing sections, on the same paper-card language. */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" data-skip-globe>
          <div
            className="animate-fade absolute inset-0 bg-ink/60 backdrop-blur-[2px]"
            onClick={closeAdd}
            data-skip-globe
          />
          <div
            className="paper-card animate-rise relative w-full max-w-md rounded-md p-7 shadow-lift md:p-8"
            data-skip-globe
          >
            <p className="eyebrow">Getting started</p>
            <h2 className="mt-2 font-serif text-3xl">Add a business</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Tell us which business to watch — its name, type, and neighbourhood anchor every scan
              and brief.
            </p>
            <form onSubmit={onSubmitAdd} className="mt-6 space-y-3" noValidate>
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
                placeholder="Neighbourhood, city (e.g. Shoreditch, London)"
                aria-label="Location"
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
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
                disabled={addState === "saving"}
                className="w-full rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent disabled:opacity-60"
              >
                {addState === "saving" ? "Adding…" : "Add business"}
              </button>
              {addState === "error" && addError && (
                <p className="text-sm text-signal-red">{addError}</p>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                The free plan includes one business. Paid plans (coming soon) let you watch more.
              </p>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

const inputCls =
  "w-full rounded-sm border border-rule/80 bg-card/50 px-3.5 py-3 text-sm text-foreground backdrop-blur-sm transition-colors placeholder:text-muted-foreground/60 focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20";