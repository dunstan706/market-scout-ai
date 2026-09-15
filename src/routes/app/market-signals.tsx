import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  WorkspaceShell,
  LocationBar,
  PageCard,
  useWorkspaceContext,
} from "@/components/WorkspaceShell";
import { btnGhost, btnPrimary, EmptyHint, SourceChip, inputCls } from "@/components/workspace-ui";
import {
  deleteCompetitorEvent,
  listCompetitorEvents,
  listCompetitors,
  saveCompetitorEvent,
  type CompetitorEventRow,
} from "@/lib/workspace.functions";

export const Route = createFileRoute("/app/market-signals")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ title: "Market signals — theBizScope" }],
  }),
  component: MarketSignalsPage,
});

const KIND_OPTIONS = [
  { value: "new_opening", label: "New opening" },
  { value: "closing", label: "Closing" },
  { value: "development", label: "Local development" },
  { value: "price_change", label: "Price change" },
  { value: "promotion_change", label: "Promotion change" },
  { value: "note", label: "Note" },
];

function MarketSignalsPage() {
  const { authChecked, signedIn, businesses, businessId, setBusinessId } =
    useWorkspaceContext();
  const loadEvents = useServerFn(listCompetitorEvents);
  const loadCompetitors = useServerFn(listCompetitors);
  const persistEvent = useServerFn(saveCompetitorEvent);
  const removeEvent = useServerFn(deleteCompetitorEvent);

  const [events, setEvents] = useState<CompetitorEventRow[] | null>(null);
  const [competitorOptions, setCompetitorOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");

  // Add form state
  const [kind, setKind] = useState("new_opening");
  const [competitorId, setCompetitorId] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!businessId) return;
    try {
      const [ev, comps] = await Promise.all([
        loadEvents({ data: { businessId } }),
        loadCompetitors({ data: { businessId } }),
      ]);
      setEvents(ev.events);
      setCompetitorOptions(comps.competitors.map((c) => ({ id: c.id, name: c.name })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the feed.");
    }
  }, [businessId, loadEvents, loadCompetitors]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (authChecked && !signedIn) return <Navigate to="/login" />;

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!businessId) return;
    setSaving(true);
    setError("");
    try {
      await persistEvent({
        data: {
          businessId,
          competitorId: competitorId || null,
          eventKind: kind,
          title,
          detail: detail || null,
          sourceUrl: sourceUrl || null,
          sourceLabel: sourceLabel || null,
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
        },
      });
      setTitle("");
      setDetail("");
      setSourceUrl("");
      setSourceLabel("");
      setOccurredAt("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the event.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (!businessId || !window.confirm("Delete this entry from the feed?")) return;
    try {
      await removeEvent({ data: { businessId, id } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    }
  }

  return (
    <WorkspaceShell
      activeKey="signals"
      businesses={businesses}
      businessId={businessId}
      onBusinessChange={setBusinessId}
    >
      <PageCard
        eyebrow="Neighbourhood change feed"
        title="What's shifting around you"
        description="Openings, closings, and local developments you're tracking — each entry with its source. Feed items feed the weekly brief and the alert rules."
      >
        <div className="mt-6">
          <LocationBar businesses={businesses} businessId={businessId} onChange={setBusinessId} />
        </div>
      </PageCard>

      <section className="paper-card mt-6 rounded-md p-6 shadow-lift">
        <h2 className="font-serif text-xl">Add to the feed</h2>
        <form onSubmit={onAdd} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">What happened</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-neutral-950">
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">Related competitor (optional)</span>
            <select value={competitorId} onChange={(e) => setCompetitorId(e.target.value)} className={inputCls}>
              <option value="" className="bg-neutral-950">— none —</option>
              {competitorOptions.map((c) => (
                <option key={c.id} value={c.id} className="bg-neutral-950">
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">Title *</span>
            <input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Second salon opens on Main Street" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">Detail</span>
            <textarea rows={2} maxLength={1000} value={detail} onChange={(e) => setDetail(e.target.value)} className={inputCls} placeholder="What changed, who's affected, and why it matters." />
          </label>
          <input type="url" maxLength={500} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className={inputCls} placeholder="Source URL (https://…)" />
          <input maxLength={120} value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} className={inputCls} placeholder="Source label (e.g. local council notice)" />
          <label className="block">
            <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">When (optional)</span>
            <input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className={inputCls} />
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? "Saving…" : "Add to feed"}
            </button>
          </div>
        </form>
      </section>

      {error ? (
        <p className="mt-4 rounded-sm border border-signal-red/40 px-4 py-3 text-sm text-signal-red">{error}</p>
      ) : null}

      <section className="paper-card mt-6 rounded-md p-6 shadow-lift">
        <h2 className="font-serif text-xl">The feed</h2>
        <div className="mt-4 space-y-4">
          {events === null ? (
            <EmptyHint>Loading…</EmptyHint>
          ) : events.length === 0 ? (
            <EmptyHint>Nothing recorded yet for this location.</EmptyHint>
          ) : (
            events.map((ev) => (
              <article key={ev.id} className="border-b border-rule pb-4 last:border-b-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium text-foreground">{ev.title}</h3>
                  <span className="text-xs text-muted-foreground">
                    {new Date(ev.occurredAt).toLocaleDateString()}
                  </span>
                </div>
                {ev.detail ? <p className="mt-1 text-sm text-muted-foreground">{ev.detail}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-sm border border-rule px-1.5 py-0.5">
                    {KIND_OPTIONS.find((k) => k.value === ev.eventKind)?.label ?? ev.eventKind}
                  </span>
                  <SourceChip label={ev.sourceLabel ?? null} url={ev.sourceUrl} />
                  <button
                    type="button"
                    onClick={() => void onDelete(ev.id)}
                    className="text-signal-red/80 transition-colors hover:text-signal-red"
                  >
                    delete
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </WorkspaceShell>
  );
}
