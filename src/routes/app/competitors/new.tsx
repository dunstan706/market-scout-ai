import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  WorkspaceShell,
  PageCard,
  useWorkspaceContext,
} from "@/components/WorkspaceShell";
import { btnGhost, btnPrimary, inputCls } from "@/components/workspace-ui";
import {
  FACT_FIELDS,
  listCompetitors,
  saveCompetitor,
  type CompetitorProfile,
  type FactField,
} from "@/lib/workspace.functions";

export const Route = createFileRoute("/app/competitors/new")({
  head: () => ({
    meta: [{ title: "Add competitor — theBizScope" }],
  }),
  component: NewCompetitorPage,
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

type FactDraft = {
  value: string;
  status: "reported" | "unknown" | "unavailable";
  sourceUrl: string;
  sourceLabel: string;
  needsReview: boolean;
};

const EMPTY_FACTS: Record<FactField, FactDraft> = {
  price_signal: { value: "", status: "reported", sourceUrl: "", sourceLabel: "", needsReview: false },
  promotion: { value: "", status: "reported", sourceUrl: "", sourceLabel: "", needsReview: false },
  rating: { value: "", status: "reported", sourceUrl: "", sourceLabel: "", needsReview: false },
  hours: { value: "", status: "reported", sourceUrl: "", sourceLabel: "", needsReview: false },
  social_activity: { value: "", status: "reported", sourceUrl: "", sourceLabel: "", needsReview: false },
  openings: { value: "", status: "reported", sourceUrl: "", sourceLabel: "", needsReview: false },
  other: { value: "", status: "reported", sourceUrl: "", sourceLabel: "", needsReview: false },
};

function draftFromProfile(profile: CompetitorProfile): Record<FactField, FactDraft> {
  const draft = { ...EMPTY_FACTS };
  for (const field of FACT_FIELDS) {
    const fact = profile.facts[field];
    draft[field] = {
      value: fact.value ?? "",
      status: fact.status,
      sourceUrl: fact.sourceUrl ?? "",
      sourceLabel: fact.sourceLabel ?? "",
      needsReview: fact.needsReview,
    };
  }
  return draft;
}

function NewCompetitorPage() {
  const { authChecked, signedIn, businesses, businessId, setBusinessId } =
    useWorkspaceContext();
  const navigate = useNavigate();
  const loadCompetitors = useServerFn(listCompetitors);
  const persist = useServerFn(saveCompetitor);

  const editId = (() => {
    try {
      return new URLSearchParams(window.location.search).get("edit");
    } catch {
      return null;
    }
  })();

  const [loadingDraft, setLoadingDraft] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Identity fields
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [area, setArea] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [status, setStatus] = useState<"open" | "closed" | "unknown">("open");
  const [notes, setNotes] = useState("");
  const [facts, setFacts] = useState<Record<FactField, FactDraft>>({ ...EMPTY_FACTS });

  useEffect(() => {
    if (!editId || !businessId) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await loadCompetitors({ data: { businessId } });
        if (cancelled) return;
        const found = result.competitors.find((c) => c.id === editId);
        if (found) {
          setName(found.name);
          setCategory(found.category ?? "");
          setArea(found.area ?? "");
          setWebsiteUrl(found.websiteUrl ?? "");
          setStatus(found.status);
          setNotes(found.notes ?? "");
          setFacts(draftFromProfile(found));
        }
      } finally {
        if (!cancelled) setLoadingDraft(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editId, businessId, loadCompetitors]);

  if (authChecked && !signedIn) return <Navigate to="/login" />;

  function setFact(field: FactField, patch: Partial<FactDraft>) {
    setFacts((prev) => ({ ...prev, [field]: { ...prev[field], ...patch } }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!businessId) {
      setError("Pick a location first.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await persist({
        data: {
          id: editId ?? undefined,
          businessId,
          name,
          category: category || null,
          area: area || null,
          websiteUrl: websiteUrl || null,
          googlePlaceId: null,
          notes: notes || null,
          status,
          facts: FACT_FIELDS.map((field) => ({
            field,
            value: facts[field].value || null,
            status: facts[field].value ? facts[field].status : facts[field].status === "unavailable" ? "unavailable" : "unknown",
            sourceUrl: facts[field].sourceUrl || null,
            sourceLabel: facts[field].sourceLabel || null,
            effectiveDate: null,
            needsReview: facts[field].needsReview,
          })),
        },
      });
      await navigate({ to: "/app/competitors" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the competitor.");
    } finally {
      setSaving(false);
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
        eyebrow={editId ? "Edit competitor" : "New competitor"}
        title={editId ? "Update the record" : "Add a competitor"}
        description="Fill in what you actually know. Anything you're unsure of stays 'unknown' rather than being guessed, and anything they don't publish can be marked not available."
      >
        <form onSubmit={onSubmit} className="mt-6 space-y-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">Name *</span>
              <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Studio Lime" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">Category</span>
              <input maxLength={80} value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} placeholder="Hair salon" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">Area / neighbourhood</span>
              <input maxLength={120} value={area} onChange={(e) => setArea(e.target.value)} className={inputCls} placeholder="Old Town" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">Website</span>
              <input type="url" maxLength={500} value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} className={inputCls} placeholder="https://…" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputCls}>
                <option value="open" className="bg-neutral-950">Open</option>
                <option value="closed" className="bg-neutral-950">Closed</option>
                <option value="unknown" className="bg-neutral-950">Unknown</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">Notes</span>
              <textarea maxLength={1000} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Context worth remembering — rebrand rumours, renovation, ownership…" />
            </label>
          </div>

          <div>
            <h2 className="font-serif text-xl">Details</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Each field saves its own source. Leave a field empty to record it as unknown; choose "not published" when they simply don't share it.
            </p>
            <div className="mt-4 space-y-5">
              {FACT_FIELDS.map((field) => (
                <div key={field} className="rounded-sm border border-rule p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{FIELD_LABEL[field]}</span>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={facts[field].status === "unavailable"}
                          onChange={(e) => setFact(field, { status: e.target.checked ? "unavailable" : "reported" })}
                        />
                        not published
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={facts[field].needsReview}
                          onChange={(e) => setFact(field, { needsReview: e.target.checked })}
                        />
                        needs review
                      </label>
                    </span>
                  </div>
                  {facts[field].status !== "unavailable" ? (
                    <input
                      maxLength={280}
                      value={facts[field].value}
                      onChange={(e) => setFact(field, { value: e.target.value })}
                      className={`${inputCls} mt-3`}
                      placeholder={field === "rating" ? "4.6 on Google (Aug)" : field === "promotion" ? "-20% opening offer" : "What you observed"}
                    />
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input
                      type="url"
                      maxLength={500}
                      value={facts[field].sourceUrl}
                      onChange={(e) => setFact(field, { sourceUrl: e.target.value })}
                      className={inputCls}
                      placeholder="Source URL (https://…)"
                    />
                    <input
                      maxLength={120}
                      value={facts[field].sourceLabel}
                      onChange={(e) => setFact(field, { sourceLabel: e.target.value })}
                      className={inputCls}
                      placeholder="Source label (e.g. their Instagram)"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error ? (
            <p className="rounded-sm border border-signal-red/40 px-4 py-3 text-sm text-signal-red">{error}</p>
          ) : null}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving || loadingDraft} className={btnPrimary}>
              {saving ? "Saving…" : editId ? "Save changes" : "Add competitor"}
            </button>
            <button type="button" onClick={() => void navigate({ to: "/app/competitors" })} className={btnGhost}>
              Cancel
            </button>
          </div>
        </form>
      </PageCard>
    </WorkspaceShell>
  );
}
