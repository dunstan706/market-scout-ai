import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  WorkspaceShell,
  LocationBar,
  PageCard,
  useWorkspaceContext,
} from "@/components/WorkspaceShell";
import { EmptyHint, HealthChip } from "@/components/workspace-ui";
import {
  listCompetitors,
  listTrackedSources,
  listCompetitorEvents,
  listWorkspaceBriefs,
} from "@/lib/workspace.functions";

export const Route = createFileRoute("/app/")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ title: "Workspace — theBizScope" }],
  }),
  component: WorkspaceOverview,
});

function WorkspaceOverview() {
  const { authChecked, signedIn, businesses, businessId, setBusinessId } =
    useWorkspaceContext();

  const loadCompetitors = useServerFn(listCompetitors);
  const loadSources = useServerFn(listTrackedSources);
  const loadEvents = useServerFn(listCompetitorEvents);
  const loadBriefs = useServerFn(listWorkspaceBriefs);

  const [counts, setCounts] = useState<{
    competitors: number;
    sources: number;
    unhealthy: number;
    events: number;
    drafts: number;
    published: number;
  } | null>(null);
  const [recentEvents, setRecentEvents] = useState<
    Array<{ id: string; title: string; eventKind: string; occurredAt: string }>
  >([]);
  const [attention, setAttention] = useState<
    Array<{ id: string; label: string; status: string }>
  >([]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [comps, sources, events, briefs] = await Promise.all([
          loadCompetitors({ data: { businessId } }),
          loadSources({ data: { businessId } }),
          loadEvents({ data: { businessId } }),
          loadBriefs({ data: { businessId } }),
        ]);
        if (cancelled) return;
        setCounts({
          competitors: comps.competitors.length,
          sources: sources.sources.length,
          unhealthy: sources.sources.filter((s) => s.status !== "active").length,
          events: events.events.length,
          drafts: briefs.briefs.filter((b) => b.status === "draft").length,
          published: briefs.briefs.filter((b) => b.status === "published").length,
        });
        setRecentEvents(events.events.slice(0, 5));
        setAttention(sources.sources.filter((s) => s.status !== "active").slice(0, 5));
      } catch {
        if (!cancelled) setCounts(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, loadCompetitors, loadSources, loadEvents, loadBriefs]);

  if (authChecked && !signedIn) return <Navigate to="/login" />;

  return (
    <WorkspaceShell
      activeKey="overview"
      businesses={businesses}
      businessId={businessId}
      onBusinessChange={setBusinessId}
    >
      <PageCard
        eyebrow="Market workspace"
        title="Your market at a glance"
        description="Competitors, sources, signals, and briefs for the selected location. Everything here is either sourced or explicitly unknown — never guessed."
      >
        <div className="mt-6">
          <LocationBar
            businesses={businesses}
            businessId={businessId}
            onChange={setBusinessId}
          />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Competitors", value: counts?.competitors },
            { label: "Sources", value: counts?.sources },
            { label: "Need attention", value: counts?.unhealthy },
            { label: "Signals", value: counts?.events },
            { label: "Drafts", value: counts?.drafts },
            { label: "Published", value: counts?.published },
          ].map((tile) => (
            <div
              key={tile.label}
              className="rounded-sm border border-rule bg-card/40 p-4 backdrop-blur-sm"
            >
              <p className="font-serif text-2xl text-foreground">{tile.value ?? "…"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{tile.label}</p>
            </div>
          ))}
        </div>
      </PageCard>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="paper-card rounded-md p-6 shadow-lift">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-serif text-xl">Recent signals</h2>
            <Link to="/app/market-signals" className="text-xs text-accent hover:underline">
              Open feed →
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {recentEvents.length === 0 ? (
              <EmptyHint>
                Nothing recorded yet. Add openings, closings, and local developments from the signals feed.
              </EmptyHint>
            ) : (
              recentEvents.map((e) => (
                <div key={e.id} className="border-b border-rule pb-3 last:border-b-0">
                  <p className="text-sm text-foreground">{e.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {e.eventKind.replace(/_/g, " ")} · {new Date(e.occurredAt).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="paper-card rounded-md p-6 shadow-lift">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-serif text-xl">Sources needing attention</h2>
            <Link to="/app/sources" className="text-xs text-accent hover:underline">
              All sources →
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {attention.length === 0 ? (
              <EmptyHint>
                {counts === null ? "Loading source health…" : "All tracked sources are healthy."}
              </EmptyHint>
            ) : (
              attention.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 border-b border-rule pb-3 last:border-b-0"
                >
                  <p className="truncate text-sm text-foreground">{s.label}</p>
                  <HealthChip status={s.status} />
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}
