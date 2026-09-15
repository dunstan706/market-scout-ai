import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  WorkspaceShell,
  PageCard,
  useWorkspaceContext,
} from "@/components/WorkspaceShell";
import { btnGhost, EmptyHint, HealthChip } from "@/components/workspace-ui";
import {
  listCompetitors,
  listTrackedSources,
  listWorkspaceBriefs,
} from "@/lib/workspace.functions";
import { listBusinesses } from "@/lib/account.functions";

export const Route = createFileRoute("/app/locations")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ title: "Locations — theBizScope" }],
  }),
  component: LocationsPage,
});

type LocationSummary = {
  id: string;
  name: string;
  location: string;
  competitors: number;
  unhealthySources: number;
  latestBrief: { status: string; createdAt: string } | null;
};

function LocationsPage() {
  const { authChecked, signedIn, businesses, businessId, setBusinessId } =
    useWorkspaceContext();
  const loadBusinesses = useServerFn(listBusinesses);
  const loadCompetitors = useServerFn(listCompetitors);
  const loadSources = useServerFn(listTrackedSources);
  const loadBriefs = useServerFn(listWorkspaceBriefs);

  const [summaries, setSummaries] = useState<LocationSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { businesses: list } = await loadBusinesses();
        const rows: LocationSummary[] = [];
        for (const b of list ?? []) {
          const [comps, sources, briefs] = await Promise.all([
            loadCompetitors({ data: { businessId: b.id } }),
            loadSources({ data: { businessId: b.id } }),
            loadBriefs({ data: { businessId: b.id, includeDrafts: true } }),
          ]);
          const latest = briefs.briefs[0];
          rows.push({
            id: b.id,
            name: b.businessName || "Unnamed business",
            location: b.location,
            competitors: comps.competitors.length,
            unhealthySources: sources.sources.filter((s) => s.status !== "active").length,
            latestBrief: latest
              ? { status: latest.status, createdAt: latest.createdAt }
              : null,
          });
        }
        if (!cancelled) setSummaries(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load locations.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBusinesses, loadCompetitors, loadSources, loadBriefs]);

  if (authChecked && !signedIn) return <Navigate to="/login" />;

  const rollup = summaries
    ? summaries.reduce(
        (acc, s) => ({
          competitors: acc.competitors + s.competitors,
          unhealthy: acc.unhealthy + s.unhealthySources,
        }),
        { competitors: 0, unhealthy: 0 },
      )
    : null;

  return (
    <WorkspaceShell
      activeKey="locations"
      businesses={businesses}
      businessId={businessId}
      onBusinessChange={setBusinessId}
    >
      <PageCard
        eyebrow="Multi-location"
        title="Every location, one view"
        description="Each card is one tracked location. Pick a location to filter the whole workspace; the roll-up tiles aggregate across all of them."
      >
        {rollup ? (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-sm border border-rule bg-card/40 p-4">
              <p className="font-serif text-2xl text-foreground">{summaries?.length ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">Locations</p>
            </div>
            <div className="rounded-sm border border-rule bg-card/40 p-4">
              <p className="font-serif text-2xl text-foreground">{rollup.competitors}</p>
              <p className="mt-1 text-xs text-muted-foreground">Competitors tracked</p>
            </div>
            <div className="rounded-sm border border-rule bg-card/40 p-4">
              <p className={`font-serif text-2xl ${rollup.unhealthy > 0 ? "text-signal-amber" : "text-foreground"}`}>
                {rollup.unhealthy}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Sources need attention</p>
            </div>
          </div>
        ) : null}
      </PageCard>

      {error ? (
        <p className="mt-4 rounded-sm border border-signal-red/40 px-4 py-3 text-sm text-signal-red">{error}</p>
      ) : null}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {summaries === null ? (
          <EmptyHint>Loading locations…</EmptyHint>
        ) : summaries.length === 0 ? (
          <EmptyHint>No businesses yet — add one from the dashboard.</EmptyHint>
        ) : (
          summaries.map((s) => (
            <section key={s.id} className="paper-card rounded-md p-6 shadow-lift">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2 className="font-serif text-xl text-foreground">{s.name}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.location}</p>
                </div>
                <button type="button" onClick={() => setBusinessId(s.id)} className={btnGhost}>
                  {s.id === businessId ? "Active" : "Filter workspace"}
                </button>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <p className="flex items-center justify-between border-b border-rule pb-2">
                  <span className="text-muted-foreground">Competitors</span>
                  <span className="text-foreground">{s.competitors}</span>
                </p>
                <p className="flex items-center justify-between border-b border-rule pb-2">
                  <span className="text-muted-foreground">Latest brief</span>
                  <span className="text-foreground">
                    {s.latestBrief
                      ? `${s.latestBrief.status} · ${new Date(s.latestBrief.createdAt).toLocaleDateString()}`
                      : "none yet"}
                  </span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-muted-foreground">Sources</span>
                  <HealthChip status={s.unhealthySources > 0 ? "needs_review" : "active"} />
                </p>
              </div>
              <div className="mt-4 flex gap-2">
                <Link to="/app/competitors" className={btnGhost}>
                  Competitors
                </Link>
                <Link to="/app/briefs" className={btnGhost}>
                  Briefs
                </Link>
              </div>
            </section>
          ))
        )}
      </div>
    </WorkspaceShell>
  );
}
