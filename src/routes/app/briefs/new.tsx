import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  WorkspaceShell,
  PageCard,
  useWorkspaceContext,
} from "@/components/WorkspaceShell";
import { btnGhost, btnPrimary, EmptyHint, inputCls, TONE_COLOR } from "@/components/workspace-ui";
import {
  listCompetitorEvents,
  listWorkspaceBriefs,
  publishBrief,
  saveBriefDraft,
  updateBriefDraft,
} from "@/lib/workspace.functions";

export const Route = createFileRoute("/app/briefs/new")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ title: "Compose brief — theBizScope" }],
  }),
  component: ComposeBriefPage,
});

type SignalDraft = { tone: "green" | "amber" | "red" | "neutral"; label: string; headline: string; detail: string };
type SourceDraft = { label: string; url: string; kind: string };

const EMPTY_SIGNAL: SignalDraft = { tone: "neutral", label: "", headline: "", detail: "" };

function ComposeBriefPage() {
  const { authChecked, signedIn, businesses, businessId, setBusinessId } =
    useWorkspaceContext();
  const navigate = useNavigate();
  const loadEvents = useServerFn(listCompetitorEvents);
  const loadBriefs = useServerFn(listWorkspaceBriefs);
  const saveDraft = useServerFn(saveBriefDraft);
  const updateDraft = useServerFn(updateBriefDraft);
  const doPublish = useServerFn(publishBrief);

  const params = (() => {
    try {
      return new URLSearchParams(window.location.search);
    } catch {
      return new URLSearchParams();
    }
  })();
  const draftId = params.get("draftId");
  const forcedBusinessId = params.get("businessId");
  const activeBusinessId = forcedBusinessId || businessId;

  const [loading, setLoading] = useState(Boolean(draftId));
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [intro, setIntro] = useState("");
  const [signals, setSignals] = useState<SignalDraft[]>([{ ...EMPTY_SIGNAL }]);
  const [sources, setSources] = useState<SourceDraft[]>([{ label: "", url: "", kind: "website" }]);
  const [savedId, setSavedId] = useState<string | null>(draftId);

  // Seed from an existing draft, or from the week's saved signals.
  const seed = useCallback(async () => {
    if (!activeBusinessId) return;
    setLoading(true);
    setError("");
    try {
      if (draftId) {
        const { briefs } = await loadBriefs({ data: { businessId: activeBusinessId, includeDrafts: true } });
        const found = briefs.find((b) => b.id === draftId);
        if (found && found.status === "draft") {
          const b = (found.brief ?? {}) as {
            title?: string;
            intro?: string;
            signals?: Array<{ tone?: string; label?: string; headline?: string; detail?: string }>;
            sources?: Array<{ label?: string; url?: string; kind?: string }>;
          };
          setTitle(typeof b.title === "string" ? b.title : "");
          setIntro(typeof b.intro === "string" ? b.intro : "");
          setSignals(
            Array.isArray(b.signals) && b.signals.length > 0
              ? b.signals.map((s) => ({
                  tone: (s.tone as SignalDraft["tone"]) ?? "neutral",
                  label: s.label ?? "",
                  headline: s.headline ?? "",
                  detail: s.detail ?? "",
                }))
              : [{ ...EMPTY_SIGNAL }],
          );
          setSources(
            Array.isArray(b.sources) && b.sources.length > 0
              ? b.sources.map((s) => ({ label: s.label ?? "", url: s.url ?? "", kind: s.kind ?? "website" }))
              : [{ label: "", url: "", kind: "website" }],
          );
          setSavedId(found.id);
          return;
        }
      }
      // Fresh compose: pre-fill signals from this week's feed entries.
      const { events } = await loadEvents({ data: { businessId: activeBusinessId, limit: 8 } });
      if (events.length > 0) {
        setSignals(
          events.slice(0, 6).map((ev) => ({
            tone: ev.eventKind === "closing" ? ("amber" as const) : ("neutral" as const),
            label: ev.eventKind.replace(/_/g, " "),
            headline: ev.title,
            detail: ev.detail ?? "",
          })),
        );
        setSources(
          events
            .filter((ev) => ev.sourceUrl)
            .slice(0, 6)
            .map((ev) => ({ label: ev.sourceLabel ?? ev.title, url: ev.sourceUrl ?? "", kind: "website" })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the draft.");
    } finally {
      setLoading(false);
    }
  }, [activeBusinessId, draftId, loadBriefs, loadEvents]);

  useEffect(() => {
    void seed();
  }, [seed]);

  if (authChecked && !signedIn) return <Navigate to="/login" />;

  function buildPayload() {
    return {
      title: title.trim() || undefined,
      intro: intro.trim() || undefined,
      signals: signals
        .filter((s) => s.headline.trim())
        .map((s) => ({ tone: s.tone, label: s.label.trim() || "signal", headline: s.headline.trim(), detail: s.detail.trim() })),
      sources: sources
        .filter((s) => s.url.trim())
        .map((s) => ({ label: s.label.trim() || "source", url: s.url.trim(), kind: s.kind })),
    };
  }

  async function onSaveDraft() {
    if (!activeBusinessId) return;
    setSaving(true);
    setError("");
    try {
      const brief = buildPayload();
      if (savedId) {
        await updateDraft({ data: { id: savedId, businessId: activeBusinessId, brief } });
      } else {
        const { id } = await saveDraft({ data: { businessId: activeBusinessId, brief } });
        setSavedId(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the draft.");
    } finally {
      setSaving(false);
    }
  }

  async function onPublish() {
    if (!activeBusinessId) return;
    setPublishing(true);
    setError("");
    try {
      await onSaveDraft();
      if (savedId) {
        await doPublish({ data: { id: savedId, businessId: activeBusinessId } });
        await navigate({ to: "/app/briefs" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish the brief.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <WorkspaceShell
      activeKey="briefs"
      businesses={businesses}
      businessId={businessId}
      onBusinessChange={setBusinessId}
      maxW="max-w-4xl"
    >
      <PageCard
        eyebrow={draftId ? "Review draft" : "Compose brief"}
        title="Shape the week's story"
        description="Edit freely, attach the sources behind every claim, then publish. Publishing locks the brief — it becomes permanent history."
      >
        {loading ? (
          <div className="mt-6">
            <EmptyHint>Loading…</EmptyHint>
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">Title</span>
                <input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Week 37 — two openings, one promotion ends" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">Intro</span>
                <textarea rows={3} maxLength={2000} value={intro} onChange={(e) => setIntro(e.target.value)} className={inputCls} placeholder="Two sentences on the state of your market this week." />
              </label>
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-serif text-xl">Signals</h2>
                <button type="button" onClick={() => setSignals((p) => [...p, { ...EMPTY_SIGNAL }])} className={btnGhost}>
                  + Add signal
                </button>
              </div>
              <div className="mt-4 space-y-4">
                {signals.map((s, i) => (
                  <div key={i} className="rounded-sm border border-rule p-4">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <select
                        value={s.tone}
                        onChange={(e) => setSignals((p) => p.map((x, j) => (j === i ? { ...x, tone: e.target.value as SignalDraft["tone"] } : x)))}
                        className={inputCls}
                      >
                        {["neutral", "green", "amber", "red"].map((t) => (
                          <option key={t} value={t} className="bg-neutral-950">
                            {t}
                          </option>
                        ))}
                      </select>
                      <input
                        maxLength={80}
                        value={s.label}
                        onChange={(e) => setSignals((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                        className={inputCls}
                        placeholder="label (e.g. new opening)"
                      />
                      <input
                        maxLength={200}
                        value={s.headline}
                        onChange={(e) => setSignals((p) => p.map((x, j) => (j === i ? { ...x, headline: e.target.value } : x)))}
                        className={`${inputCls} sm:col-span-2`}
                        placeholder="headline"
                      />
                    </div>
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={s.detail}
                      onChange={(e) => setSignals((p) => p.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)))}
                      className={`${inputCls} mt-3`}
                      placeholder="detail — what happened and why it matters"
                    />
                    <button
                      type="button"
                      onClick={() => setSignals((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : p))}
                      className="mt-2 text-xs text-signal-red/80 hover:text-signal-red"
                    >
                      remove signal
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-serif text-xl">Sources</h2>
                <button type="button" onClick={() => setSources((p) => [...p, { label: "", url: "", kind: "website" }])} className={btnGhost}>
                  + Add source
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {sources.map((s, i) => (
                  <div key={i} className="grid gap-3 sm:grid-cols-8">
                    <input
                      maxLength={160}
                      value={s.label}
                      onChange={(e) => setSources((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                      className={`${inputCls} sm:col-span-2`}
                      placeholder="label"
                    />
                    <input
                      type="url"
                      maxLength={500}
                      value={s.url}
                      onChange={(e) => setSources((p) => p.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                      className={`${inputCls} sm:col-span-4`}
                      placeholder="https://…"
                    />
                    <select
                      value={s.kind}
                      onChange={(e) => setSources((p) => p.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}
                      className={`${inputCls} sm:col-span-1`}
                    >
                      {["website", "directory", "reviews", "news", "social"].map((k) => (
                        <option key={k} value={k} className="bg-neutral-950">
                          {k}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setSources((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : p))}
                      className="text-xs text-signal-red/80 hover:text-signal-red sm:col-span-1"
                    >
                      remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {error ? (
              <p className="rounded-sm border border-signal-red/40 px-4 py-3 text-sm text-signal-red">{error}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void onSaveDraft()} disabled={saving || publishing} className={btnGhost}>
                {saving ? "Saving…" : "Save draft"}
              </button>
              <button type="button" onClick={() => void onPublish()} disabled={saving || publishing} className={btnPrimary}>
                {publishing ? "Publishing…" : "Publish brief"}
              </button>
              <button type="button" onClick={() => void navigate({ to: "/app/briefs" })} className={btnGhost}>
                Cancel
              </button>
              <span className="text-xs text-muted-foreground">Preview tone colors:</span>
              {["green", "amber", "red"].map((t) => (
                <span key={t} className={`text-xs ${TONE_COLOR[t]}`}>
                  ●
                </span>
              ))}
            </div>
          </div>
        )}
      </PageCard>
    </WorkspaceShell>
  );
}
