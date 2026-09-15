import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  WorkspaceShell,
  LocationBar,
  PageCard,
  useWorkspaceContext,
} from "@/components/WorkspaceShell";
import { EmptyHint, btnGhost } from "@/components/workspace-ui";
import { listWorkspaceBriefs, type BriefRow } from "@/lib/workspace.functions";

export const Route = createFileRoute("/app/briefs/")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ title: "Briefs — theBizScope" }],
  }),
  component: BriefsPage,
});

type BriefContent = {
  title?: string;
  intro?: string;
  signals?: Array<{ tone?: string; label?: string; headline?: string; detail?: string }>;
  sources?: Array<{ label?: string; url?: string; kind?: string }>;
};

function readBrief(raw: unknown): BriefContent {
  if (!raw || typeof raw !== "object") return {};
  const b = raw as BriefContent;
  const out: BriefContent = {};
  if (typeof b.title === "string") out.title = b.title;
  if (typeof b.intro === "string") out.intro = b.intro;
  out.signals = Array.isArray(b.signals) ? b.signals : [];
  out.sources = Array.isArray(b.sources) ? b.sources : [];
  return out;
}

function BriefsPage() {
  const { authChecked, signedIn, businesses, businessId, setBusinessId } =
    useWorkspaceContext();
  const loadBriefs = useServerFn(listWorkspaceBriefs);

  const [briefs, setBriefs] = useState<BriefRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await loadBriefs({ data: { businessId, includeDrafts: true } });
        if (!cancelled) setBriefs(result.briefs);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load briefs.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, loadBriefs]);

  if (authChecked && !signedIn) return <Navigate to="/login" />;

  return (
    <WorkspaceShell
      activeKey="briefs"
      businesses={businesses}
      businessId={businessId}
      onBusinessChange={setBusinessId}
    >
      <PageCard
        eyebrow="Weekly briefs"
        title="What changed this week"
        description="Draft briefs from your saved signals, the automated weekly run, and anything you compose by hand. Published briefs are permanent history; drafts stay editable."
      >
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <LocationBar businesses={businesses} businessId={businessId} onChange={setBusinessId} />
          <Link to="/app/briefs/new" className={btnGhost}>
            + Compose brief
          </Link>
        </div>
      </PageCard>

      {error ? (
        <p className="mt-4 rounded-sm border border-signal-red/40 px-4 py-3 text-sm text-signal-red">{error}</p>
      ) : null}

      <div className="mt-6 space-y-6">
        {briefs === null ? (
          <EmptyHint>Loading briefs…</EmptyHint>
        ) : briefs.length === 0 ? (
          <EmptyHint>
            No briefs yet for this location. Run a scan from the dashboard, compose one yourself, or wait for the weekly run.
          </EmptyHint>
        ) : (
          briefs.map((b) => {
            const content = readBrief(b.brief);
            const signalCount = content.signals?.length ?? 0;
            const sourceCount = content.sources?.length ?? 0;
            return (
              <article key={b.id} className="paper-card rounded-md p-6 shadow-lift">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <p className="eyebrow">
                      {b.status === "draft" ? "Draft" : "Published"} ·{" "}
                      {new Date(b.createdAt).toLocaleDateString()}
                      {b.weekStart ? ` · week of ${b.weekStart}` : ""}
                    </p>
                    <h2 className="mt-1 font-serif text-xl text-foreground">
                      {content.title ?? `${b.businessName} — weekly brief`}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {b.status === "draft" ? (
                      <Link to="/app/briefs/new" search={{ draftId: b.id, businessId: b.businessId ?? businessId ?? "" }} className={btnGhost}>
                        Review & publish
                      </Link>
                    ) : (
                      <span className="rounded-sm border border-signal-green/50 px-2 py-1 text-xs text-signal-green">
                        published
                      </span>
                    )}
                  </div>
                </div>
                {content.intro ? (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{content.intro}</p>
                ) : null}
                <p className="mt-3 text-xs text-muted-foreground">
                  {signalCount} signal{signalCount === 1 ? "" : "s"} · {sourceCount} source{sourceCount === 1 ? "" : "s"}
                </p>
              </article>
            );
          })
        )}
      </div>
    </WorkspaceShell>
  );
}
