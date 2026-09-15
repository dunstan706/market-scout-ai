import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  WorkspaceShell,
  LocationBar,
  PageCard,
  useWorkspaceContext,
} from "@/components/WorkspaceShell";
import {
  btnGhost,
  btnPrimary,
  EmptyHint,
  HealthChip,
  SourceChip,
  inputCls,
} from "@/components/workspace-ui";
import {
  checkSourceHealth,
  deleteTrackedSource,
  listTrackedSources,
  saveTrackedSource,
  type TrackedSourceRow,
} from "@/lib/workspace.functions";

export const Route = createFileRoute("/app/sources")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ title: "Sources — theBizScope" }],
  }),
  component: SourcesPage,
});

function SourcesPage() {
  const { authChecked, signedIn, businesses, businessId, setBusinessId } =
    useWorkspaceContext();
  const loadSources = useServerFn(listTrackedSources);
  const persistSource = useServerFn(saveTrackedSource);
  const removeSource = useServerFn(deleteTrackedSource);
  const checkHealth = useServerFn(checkSourceHealth);

  const [sources, setSources] = useState<TrackedSourceRow[] | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [checkingId, setCheckingId] = useState<string | null>(null);

  // Add form
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState("website");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!businessId) return;
    try {
      const result = await loadSources({ data: { businessId } });
      setSources(result.sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load sources.");
    }
  }, [businessId, loadSources]);

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
      await persistSource({ data: { businessId, label, url, kind } });
      setLabel("");
      setUrl("");
      setKind("website");
      setFlash("Source added.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the source.");
    } finally {
      setSaving(false);
    }
  }

  async function onCheck(id: string) {
    if (!businessId) return;
    setCheckingId(id);
    setError("");
    setFlash("");
    try {
      const { outcome } = await checkHealth({ data: { businessId, id } });
      setFlash(
        outcome.status === "active"
          ? "Source is healthy."
          : outcome.status === "unreachable"
            ? `Source unreachable: ${outcome.error ?? "no response"}`
            : `Needs review: ${outcome.error ?? "unexpected response"}`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed.");
    } finally {
      setCheckingId(null);
    }
  }

  async function onDelete(id: string) {
    if (!businessId || !window.confirm("Stop tracking this source?")) return;
    try {
      await removeSource({ data: { businessId, id } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    }
  }

  const unhealthyCount = (sources ?? []).filter((s) => s.status !== "active").length;

  return (
    <WorkspaceShell
      activeKey="sources"
      businesses={businesses}
      businessId={businessId}
      onBusinessChange={setBusinessId}
    >
      <PageCard
        eyebrow="Tracked sources"
        title="Where the facts come from"
        description="Every URL the workspace relies on, with its last-checked date and health. Unreachable sources get flagged before they can poison a brief."
      >
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <LocationBar businesses={businesses} businessId={businessId} onChange={setBusinessId} />
          <p className="text-sm text-muted-foreground">
            {unhealthyCount > 0 ? (
              <span className="text-signal-amber">{unhealthyCount} need attention</span>
            ) : (
              "All healthy"
            )}
          </p>
        </div>
        {flash ? <p className="mt-4 text-sm text-signal-green">{flash}</p> : null}
        {error ? <p className="mt-4 rounded-sm border border-signal-red/40 px-4 py-3 text-sm text-signal-red">{error}</p> : null}
      </PageCard>

      <section className="paper-card mt-6 rounded-md p-6 shadow-lift">
        <h2 className="font-serif text-xl">Add a source</h2>
        <form onSubmit={onAdd} className="mt-4 grid gap-3 sm:grid-cols-4">
          <input required maxLength={160} value={label} onChange={(e) => setLabel(e.target.value)} className={`${inputCls} sm:col-span-1`} placeholder="Label (e.g. Their menu page)" />
          <input required type="url" maxLength={500} value={url} onChange={(e) => setUrl(e.target.value)} className={`${inputCls} sm:col-span-2`} placeholder="https://…" />
          <div className="flex gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
              {["website", "directory", "reviews", "news", "social"].map((k) => (
                <option key={k} value={k} className="bg-neutral-950">
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? "Adding…" : "Track this source"}
            </button>
          </div>
        </form>
      </section>

      <section className="paper-card mt-6 rounded-md p-6 shadow-lift">
        <h2 className="font-serif text-xl">All sources</h2>
        <div className="mt-4 space-y-4">
          {sources === null ? (
            <EmptyHint>Loading…</EmptyHint>
          ) : sources.length === 0 ? (
            <EmptyHint>No sources tracked yet for this location.</EmptyHint>
          ) : (
            sources.map((s) => (
              <article key={s.id} className="border-b border-rule pb-4 last:border-b-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium text-foreground">{s.label}</h3>
                  <HealthChip status={s.status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <SourceChip label={s.url} url={s.url} />
                  <span>kind: {s.kind}</span>
                  <span>
                    last checked:{" "}
                    {s.lastCheckedAt ? new Date(s.lastCheckedAt).toLocaleString() : "never"}
                  </span>
                  {s.lastOkAt ? <span>last OK: {new Date(s.lastOkAt).toLocaleDateString()}</span> : null}
                </div>
                {s.lastError ? (
                  <p className="mt-1 text-xs text-signal-amber">{s.lastError}</p>
                ) : null}
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" onClick={() => void onCheck(s.id)} disabled={checkingId === s.id} className={btnGhost}>
                    {checkingId === s.id ? "Checking…" : "Check now"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(s.id)}
                    className="rounded-sm border border-signal-red/40 px-3 py-2 text-sm font-medium text-signal-red transition-colors hover:bg-signal-red/10"
                  >
                    Remove
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
