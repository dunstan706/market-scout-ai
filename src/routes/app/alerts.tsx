import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  WorkspaceShell,
  LocationBar,
  PageCard,
  useWorkspaceContext,
} from "@/components/WorkspaceShell";
import { btnGhost, btnPrimary, EmptyHint, inputCls } from "@/components/workspace-ui";
import {
  deleteAlertRule,
  listAlertRules,
  saveAlertRule,
  type AlertRuleRow,
} from "@/lib/workspace.functions";

export const Route = createFileRoute("/app/alerts")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ title: "Alert rules — theBizScope" }],
  }),
  component: AlertsPage,
});

type RuleKind = "rating_decline" | "price_change" | "new_opening" | "promotion_change";

const RULE_META: Record<RuleKind, { label: string; blurb: string; thresholdLabel: string; placeholder: string }> = {
  rating_decline: {
    label: "Rating decline",
    blurb: "Fires when a competitor's recorded rating drops below the threshold.",
    thresholdLabel: "Rating below",
    placeholder: "e.g. 4.2",
  },
  price_change: {
    label: "Price change",
    blurb: "Fires when a competitor's price signal changes.",
    thresholdLabel: "Note (optional)",
    placeholder: "e.g. flag any change",
  },
  new_opening: {
    label: "New opening",
    blurb: "Fires when a new competitor or location opens in your area.",
    thresholdLabel: "Note (optional)",
    placeholder: "e.g. within 1 km",
  },
  promotion_change: {
    label: "Promotion change",
    blurb: "Fires when a competitor starts, changes, or ends a promotion.",
    thresholdLabel: "Note (optional)",
    placeholder: "e.g. anything seasonal",
  },
};

const ALL_KINDS: RuleKind[] = ["rating_decline", "price_change", "new_opening", "promotion_change"];

function AlertsPage() {
  const { authChecked, signedIn, businesses, businessId, setBusinessId } =
    useWorkspaceContext();
  const loadRules = useServerFn(listAlertRules);
  const persistRule = useServerFn(saveAlertRule);
  const removeRule = useServerFn(deleteAlertRule);

  const [rules, setRules] = useState<AlertRuleRow[] | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!businessId) return;
    try {
      const result = await loadRules({ data: { businessId } });
      setRules(result.rules);
      const drafts: Record<string, string> = {};
      for (const rule of result.rules) {
        const t = rule.threshold["note"] ?? rule.threshold["value"];
        drafts[rule.ruleKind] = typeof t === "string" ? t : typeof t === "number" ? String(t) : "";
      }
      setThresholdDrafts(drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load alert rules.");
    }
  }, [businessId, loadRules]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (authChecked && !signedIn) return <Navigate to="/login" />;

  async function onSave(kind: RuleKind, enabled: boolean) {
    if (!businessId) return;
    setError("");
    setFlash("");
    const note = thresholdDrafts[kind]?.trim();
    const threshold: Record<string, string | number | boolean> = {};
    if (note) {
      threshold["note"] = note;
      const num = Number(note);
      if (kind === "rating_decline" && Number.isFinite(num)) threshold["value"] = num;
    }
    try {
      await persistRule({ data: { businessId, ruleKind: kind, enabled, threshold } });
      setFlash(`${RULE_META[kind].label} rule saved.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the rule.");
    }
  }

  async function onDelete(id: string, kind: RuleKind) {
    if (!businessId || !window.confirm(`Remove the ${RULE_META[kind].label.toLowerCase()} rule?`)) return;
    try {
      await removeRule({ data: { businessId, id } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the rule.");
    }
  }

  const ruleByKind = new Map<string, AlertRuleRow>();
  for (const r of rules ?? []) ruleByKind.set(r.ruleKind, r);

  return (
    <WorkspaceShell
      activeKey="alerts"
      businesses={businesses}
      businessId={businessId}
      onBusinessChange={setBusinessId}
    >
      <PageCard
        eyebrow="Alert rules"
        title="Decide what wakes you up"
        description="Rules apply to the selected location. When a saved change matches a rule, it shows on your dashboard's alert strip — and emails you on the Advise plan."
      >
        <div className="mt-6">
          <LocationBar businesses={businesses} businessId={businessId} onChange={setBusinessId} />
        </div>
        {flash ? <p className="mt-4 text-sm text-signal-green">{flash}</p> : null}
        {error ? <p className="mt-4 rounded-sm border border-signal-red/40 px-4 py-3 text-sm text-signal-red">{error}</p> : null}
      </PageCard>

      <div className="mt-6 space-y-5">
        {rules === null ? (
          <EmptyHint>Loading rules…</EmptyHint>
        ) : (
          ALL_KINDS.map((kind) => {
            const rule = ruleByKind.get(kind);
            const meta = RULE_META[kind];
            return (
              <section key={kind} className="paper-card rounded-md p-6 shadow-lift">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-xl">
                    <h2 className="font-serif text-lg text-foreground">{meta.label}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{meta.blurb}</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={rule?.enabled ?? false}
                      onChange={(e) => {
                        if (rule) void onSave(kind, e.target.checked);
                        else setThresholdDrafts((prev) => ({ ...prev, [kind]: prev[kind] ?? "" }));
                        if (!rule) void onSave(kind, e.target.checked);
                      }}
                    />
                    {rule?.enabled ? "Enabled" : "Off"}
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="min-w-[220px] flex-1">
                    <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">
                      {meta.thresholdLabel}
                    </span>
                    <input
                      value={thresholdDrafts[kind] ?? ""}
                      onChange={(e) => setThresholdDrafts((prev) => ({ ...prev, [kind]: e.target.value }))}
                      className={inputCls}
                      placeholder={meta.placeholder}
                      maxLength={80}
                    />
                  </label>
                  <button type="button" onClick={() => void onSave(kind, rule?.enabled ?? true)} className={btnPrimary}>
                    {rule ? "Save" : "Create rule"}
                  </button>
                  {rule ? (
                    <>
                      <button type="button" onClick={() => void onSave(kind, !rule.enabled)} className={btnGhost}>
                        {rule.enabled ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(rule.id, kind)}
                        className="rounded-sm border border-signal-red/40 px-3 py-2 text-sm font-medium text-signal-red transition-colors hover:bg-signal-red/10"
                      >
                        Remove
                      </button>
                    </>
                  ) : null}
                </div>
              </section>
            );
          })
        )}
      </div>
    </WorkspaceShell>
  );
}
