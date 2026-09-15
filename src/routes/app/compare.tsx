import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  WorkspaceShell,
  LocationBar,
  PageCard,
  useWorkspaceContext,
} from "@/components/WorkspaceShell";
import { FactStatusChip, SourceChip, EmptyHint } from "@/components/workspace-ui";
import { listCompetitors, type CompetitorProfile, type FactField } from "@/lib/workspace.functions";
import { listBusinesses } from "@/lib/account.functions";

export const Route = createFileRoute("/app/compare")({
  head: () => ({
    meta: [{ title: "Compare — theBizScope" }],
  }),
  component: ComparePage,
});

const COLUMNS: Array<{ field: FactField; label: string }> = [
  { field: "price_signal", label: "Price signal" },
  { field: "rating", label: "Rating" },
  { field: "promotion", label: "Promotion" },
  { field: "hours", label: "Hours" },
  { field: "social_activity", label: "Social" },
];

function ComparePage() {
  const { authChecked, signedIn, businesses, businessId, setBusinessId } =
    useWorkspaceContext();
  const loadCompetitors = useServerFn(listCompetitors);
  const loadBusinesses = useServerFn(listBusinesses);

  const [competitors, setCompetitors] = useState<CompetitorProfile[] | null>(null);
  const [ownLocation, setOwnLocation] = useState<{ name: string; location: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await loadCompetitors({ data: { businessId } });
        if (!cancelled) setCompetitors(result.competitors);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, loadCompetitors]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await loadBusinesses();
        if (cancelled) return;
        const mine = (result.businesses ?? []).find((b) => b.id === businessId);
        if (mine) setOwnLocation({ name: mine.businessName, location: mine.location });
      } catch {
        /* location row is cosmetic here */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, loadBusinesses]);

  const sorted = useMemo(
    () => (competitors ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [competitors],
  );

  if (authChecked && !signedIn) return <Navigate to="/login" />;

  return (
    <WorkspaceShell
      activeKey="compare"
      businesses={businesses}
      businessId={businessId}
      onBusinessChange={setBusinessId}
    >
      <PageCard
        eyebrow="Side by side"
        title="Compare your market"
        description="Your location against every tracked competitor. Unknown cells are marked as unknown — the table never fills gaps with guesses."
      >
        <div className="mt-6">
          <LocationBar businesses={businesses} businessId={businessId} onChange={setBusinessId} />
        </div>
      </PageCard>

      {error ? (
        <p className="mt-4 rounded-sm border border-signal-red/40 px-4 py-3 text-sm text-signal-red">{error}</p>
      ) : null}

      <section className="paper-card mt-6 overflow-x-auto rounded-md p-6 shadow-lift">
        {sorted.length === 0 ? (
          <EmptyHint>
            Nothing to compare yet.{" "}
            <Link to="/app/competitors/new" className="text-accent hover:underline">
              Add a competitor
            </Link>{" "}
            first.
          </EmptyHint>
        ) : (
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-3 pr-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {ownLocation ? `${ownLocation.name} — ${ownLocation.location}` : "Your location"}
                </th>
                {sorted.map((c) => (
                  <th key={c.id} className="py-3 pr-4 text-left align-bottom">
                    <span className="font-serif text-base text-foreground">{c.name}</span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {[c.category, c.area].filter(Boolean).join(" · ") || (c.status === "closed" ? "closed" : "")}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COLUMNS.map(({ field, label }) => (
                <tr key={field} className="border-b border-rule last:border-b-0">
                  <th className="py-3 pr-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </th>
                  {sorted.map((c) => {
                    const fact = c.facts[field];
                    return (
                      <td key={`${c.id}-${field}`} className="py-3 pr-4 align-top">
                        {fact.status === "reported" ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-foreground">{fact.value}</span>
                            {fact.needsReview ? (
                              <span className="rounded-sm border border-signal-amber/60 px-1 py-0.5 text-[10px] text-signal-amber">review</span>
                            ) : null}
                            <SourceChip label={fact.sourceLabel} url={fact.sourceUrl} />
                          </span>
                        ) : (
                          <FactStatusChip status={fact.status} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-b border-rule last:border-b-0">
                <th className="py-3 pr-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Location
                </th>
                {sorted.map((c) => (
                  <td key={`${c.id}-area`} className="py-3 pr-4 text-muted-foreground">
                    {c.area ?? <FactStatusChip status="unknown" />}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Location-level differences show as each competitor's recorded area; add richer per-area facts on their profile.
        </p>
      </section>
    </WorkspaceShell>
  );
}
