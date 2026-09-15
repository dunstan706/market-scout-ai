import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  WorkspaceShell,
  LocationBar,
  PageCard,
  useWorkspaceContext,
} from "@/components/WorkspaceShell";
import {
  EmptyHint,
  FactStatusChip,
  NeedsReviewChip,
  SourceChip,
  btnDanger,
  btnGhost,
} from "@/components/workspace-ui";
import {
  deleteCompetitor,
  listCompetitors,
  type CompetitorProfile,
  type FactField,
} from "@/lib/workspace.functions";

export const Route = createFileRoute("/app/competitors/")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ title: "Competitors — theBizScope" }],
  }),
  component: CompetitorsPage,
});

const FIELD_LABEL: Record<FactField, string> = {
  price_signal: "Price signal",
  promotion: "Promotion",
  rating: "Rating",
  hours: "Opening hours",
  social_activity: "Social activity",
  openings: "Openings",
  other: "Other",
};

const FIELD_ORDER: FactField[] = [
  "price_signal",
  "promotion",
  "rating",
  "hours",
  "social_activity",
  "openings",
  "other",
];

function CompetitorsPage() {
  const { authChecked, signedIn, businesses, businessId, setBusinessId } =
    useWorkspaceContext();
  const loadCompetitors = useServerFn(listCompetitors);
  const removeCompetitor = useServerFn(deleteCompetitor);

  const [competitors, setCompetitors] = useState<CompetitorProfile[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await loadCompetitors({ data: { businessId } });
        if (!cancelled) setCompetitors(result.competitors);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load competitors.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, loadCompetitors]);

  if (authChecked && !signedIn) return <Navigate to="/login" />;

  async function onDelete(id: string) {
    if (!businessId || !window.confirm("Delete this competitor and all their tracked facts?")) return;
    setBusyId(id);
    try {
      await removeCompetitor({ data: { businessId, id } });
      setCompetitors((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <WorkspaceShell
      activeKey="competitors"
      businesses={businesses}
      businessId={businessId}
      onBusinessChange={setBusinessId}
    >
      <PageCard
        eyebrow="Competitor profiles"
        title="Everyone you're up against"
        description="Manual entries and scan findings merge into one record per competitor. Every field carries its source — or an explicit unknown."
      >
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <LocationBar businesses={businesses} businessId={businessId} onChange={setBusinessId} />
          <Link to="/app/competitors/new" className={`text-sm ${btnGhost}`}>
            + Add competitor
          </Link>
        </div>
      </PageCard>

      {error ? (
        <p className="mt-4 rounded-sm border border-signal-red/40 px-4 py-3 text-sm text-signal-red">{error}</p>
      ) : null}

      <div className="mt-6 space-y-6">
        {competitors === null ? (
          <EmptyHint>Loading competitors…</EmptyHint>
        ) : competitors.length === 0 ? (
          <EmptyHint>
            No competitors yet. Add the salons and spas you're up against — with as much or as little detail as you have.
          </EmptyHint>
        ) : (
          competitors.map((c) => (
            <section key={c.id} className="paper-card rounded-md p-6 shadow-lift">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2 className="font-serif text-xl text-foreground">{c.name}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[c.category, c.area, c.status === "closed" ? "closed" : null]
                      .filter(Boolean)
                      .join(" · ") || "no details"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/app/competitors/new?edit=${c.id}&businessId=${businessId ?? ""}`}
                    className={btnGhost}
                  >
                    Edit
                  </a>
                  <button type="button" onClick={() => void onDelete(c.id)} disabled={busyId === c.id} className={btnDanger}>
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                {FIELD_ORDER.map((field) => {
                  const fact = c.facts[field];
                  return (
                    <div key={field} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-rule py-2">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {FIELD_LABEL[field]}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-right">
                        {fact.status === "reported" ? (
                          <span className="text-sm text-foreground">{fact.value}</span>
                        ) : (
                          <FactStatusChip status={fact.status} />
                        )}
                        {fact.needsReview ? <NeedsReviewChip /> : null}
                        <SourceChip label={fact.sourceLabel} url={fact.sourceUrl} />
                      </span>
                    </div>
                  );
                })}
              </div>
              {c.websiteUrl ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Website: <SourceChip label={c.websiteUrl} url={c.websiteUrl} />
                </p>
              ) : null}
            </section>
          ))
        )}
      </div>
    </WorkspaceShell>
  );
}
