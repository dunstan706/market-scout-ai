import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ConstellationGrid } from "@/components/ConstellationGrid";
import { AnimatedNavFramer, type AnimatedNavItem } from "@/components/ui/animated-nav-framer";
import { UpgradeOverlay } from "@/components/UpgradeOverlay";
import { listBusinesses, type Business } from "@/lib/account.functions";
import { useServerFn } from "@tanstack/react-start";

// Shared shell for the market workspace (/app/*). One implementation — both
// dashboards embed or link into these same pages so the two UIs can't drift.

export function useWorkspaceBusinesses() {
  const fetchBusinesses = useServerFn(listBusinesses);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchBusinesses();
        if (!cancelled) setBusinesses(result.businesses ?? []);
      } catch {
        if (!cancelled) setBusinesses([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchBusinesses]);

  return { businesses, loading };
}

export function WorkspaceShell({
  children,
  activeKey,
  businesses,
  businessId,
  onBusinessChange,
  maxW = "max-w-6xl",
}: {
  children: ReactNode;
  activeKey: string;
  businesses: Business[];
  businessId: string | null;
  onBusinessChange: (id: string) => void;
  maxW?: string;
}) {
  const router = useRouter();
  const [pricingOpen, setPricingOpen] = useState(false);

  async function onSignOut() {
    await supabase.auth.signOut();
    await router.navigate({ to: "/" });
  }

  const businessMenu: AnimatedNavItem[] =
    businesses.length > 0
      ? businesses.map((b) => ({
          name: b.businessName || "Unnamed business",
          onClick: () => onBusinessChange(b.id),
          active: b.id === businessId,
        }))
      : [{ name: "No businesses yet — add one from the dashboard" }];

  return (
    <main className="theme-dark relative min-h-screen w-full">
      <ConstellationGrid className="fixed inset-0 h-screen w-full" warp={false} glowRadius={85} />

      <AnimatedNavFramer
        collapsible={false}
        logo={
          <Link to="/" className="whitespace-nowrap font-serif text-xl tracking-tight sm:text-2xl">
            theBizScope<span className="text-accent">.</span>
          </Link>
        }
        items={[
          {
            name: "Workspace",
            children: WORKSPACE_LINKS.map((l) => ({
              name: l.label,
              href: l.href,
              active: l.key === activeKey,
            })),
          },
          { name: "Business", children: businessMenu },
          { name: "Plans", onClick: () => setPricingOpen(true) },
          { name: "Profile", href: "/profile" },
          { name: "Sign out", onClick: onSignOut, danger: true },
        ]}
      />

      <div className={`relative z-10 mx-auto w-full ${maxW} px-4 pb-24 pt-28`}>
        {businesses.length === 0 ? (
          <section className="paper-card animate-rise rounded-md p-8 shadow-lift">
            <p className="eyebrow">Market workspace</p>
            <h1 className="mt-2 font-serif text-3xl">Add a business first</h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              The workspace tracks the market around one of your business
              locations. Create your first business from the dashboard, then
              the workspace fills with competitors, sources, and briefs.
            </p>
            <Link
              to="/dashboard"
              className="mt-6 inline-block rounded-sm border border-accent px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
            >
              Go to dashboard
            </Link>
          </section>
        ) : (
          children
        )}
      </div>

      <UpgradeOverlay open={pricingOpen} onClose={() => setPricingOpen(false)} />
    </main>
  );
}

export const WORKSPACE_LINKS: Array<{ key: string; label: string; href: string }> = [
  { key: "overview", label: "Overview", href: "/app" },
  { key: "competitors", label: "Competitors", href: "/app/competitors" },
  { key: "compare", label: "Compare", href: "/app/compare" },
  { key: "signals", label: "Market signals", href: "/app/market-signals" },
  { key: "alerts", label: "Alerts", href: "/app/alerts" },
  { key: "briefs", label: "Briefs", href: "/app/briefs" },
  { key: "sources", label: "Sources", href: "/app/sources" },
  { key: "locations", label: "Locations", href: "/app/locations" },
];

const ACTIVE_BUSINESS_KEY = "tbs.workspace.business";

// Shared per-page context: auth gate, business list, and the active location
// (persisted in localStorage so it follows the user across workspace pages).
export function useWorkspaceContext() {
  const [authChecked, setAuthChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const { businesses, loading } = useWorkspaceBusinesses();
  const [businessId, setBusinessIdState] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.user) setSignedIn(true);
      setAuthChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (businesses.length === 0) return;
    const stored = window.localStorage.getItem(ACTIVE_BUSINESS_KEY);
    const valid = stored && businesses.some((b) => b.id === stored) ? stored : null;
    setBusinessIdState(valid ?? businesses[0]?.id ?? null);
  }, [businesses]);

  const setBusinessId = (id: string) => {
    window.localStorage.setItem(ACTIVE_BUSINESS_KEY, id);
    setBusinessIdState(id);
  };

  return {
    authChecked,
    signedIn,
    loading,
    businesses,
    businessId,
    setBusinessId,
  };
}

export function LocationBar({
  businesses,
  businessId,
  onChange,
  hint,
}: {
  businesses: Business[];
  businessId: string | null;
  onChange: (id: string) => void;
  hint?: string;
}) {
  if (businesses.length <= 1) {
    const active = businesses.find((b) => b.id === businessId);
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="eyebrow">Location</p>
        <p className="text-sm text-foreground">
          {active ? `${active.businessName} — ${active.location}` : "…"}
        </p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="eyebrow">Location</p>
      <select
        value={businessId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sm border border-rule bg-card/60 px-3 py-1.5 text-sm text-foreground backdrop-blur-sm focus:border-accent focus:outline-none"
      >
        {businesses.map((b) => (
          <option key={b.id} value={b.id} className="bg-neutral-950">
            {b.businessName || "Unnamed business"} — {b.location}
          </option>
        ))
        }
      </select>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PageCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="paper-card animate-rise rounded-md p-7 shadow-lift md:p-8">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-2 font-serif text-3xl">{title}</h1>
      {description ? (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </section>
  );
}

export const fieldInputCls =
  "w-full rounded-sm border border-rule/80 bg-card/50 px-3.5 py-3 text-sm text-foreground backdrop-blur-sm transition-colors placeholder:text-muted-foreground/60 focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20";
