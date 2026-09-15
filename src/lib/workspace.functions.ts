import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { isPublicWebsiteUrl } from "@/lib/local-research.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cacheGet, cacheSet } from "@/lib/cache.server";

// Market workspace server layer. Every mutation resolves ownership
// server-side: the caller's session (requireSupabaseAuth) must own the
// business the workspace row hangs off — nothing is trusted from the client.
// Reads go through the authed client (RLS as defense in depth); writes go
// through the service-role client after the ownership check, matching the
// affiliate/business function conventions.

// ── Shared schemas ───────────────────────────────────────────────────────────

export const FACT_FIELDS = [
  "price_signal",
  "promotion",
  "rating",
  "hours",
  "social_activity",
  "openings",
  "other",
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

const FactStatus = z.enum(["reported", "unknown", "unavailable"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function validPublicUrl(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!isPublicWebsiteUrl(trimmed)) return null;
  return trimmed.slice(0, 500);
}

const FactInput = z
  .object({
    field: z.enum(FACT_FIELDS),
    value: z.string().max(280).nullable().optional(),
    status: FactStatus.default("reported"),
    sourceUrl: z.string().max(500).nullable().optional(),
    sourceLabel: z.string().max(120).nullable().optional(),
    effectiveDate: z.string().regex(DATE_RE).nullable().optional(),
    needsReview: z.boolean().default(false),
  })
  .transform((f) => {
    const status = f.status;
    const value =
      status === "reported" ? (f.value ? cleanText(f.value, 280) : null) : null;
    // "reported" with no value is meaningless — treat it as unknown instead.
    return {
      ...f,
      status: status === "reported" && !value ? ("unknown" as const) : status,
      value,
      sourceUrl: f.sourceUrl ? validPublicUrl(f.sourceUrl) : null,
      sourceLabel: f.sourceLabel ? cleanText(f.sourceLabel, 120) : null,
      effectiveDate: f.effectiveDate && DATE_RE.test(f.effectiveDate) ? f.effectiveDate : null,
    };
  });

const CompetitorInput = z.object({
  id: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  name: z.string().min(1).max(120).transform((v) => cleanText(v, 120)),
  category: z.string().max(80).nullable().optional().transform((v) => (v ? cleanText(v, 80) : null)),
  area: z.string().max(120).nullable().optional().transform((v) => (v ? cleanText(v, 120) : null)),
  websiteUrl: z.string().max(500).nullable().optional().transform((v) => (v ? validPublicUrl(v) : null)),
  googlePlaceId: z.string().max(120).nullable().optional().transform((v) => (v ? cleanText(v, 120) : null)),
  notes: z.string().max(1000).nullable().optional().transform((v) => (v ? cleanText(v, 1000) : null)),
  status: z.enum(["open", "closed", "unknown"]).default("open"),
  facts: z.array(FactInput).max(FACT_FIELDS.length).default([]),
});

const SourceInput = z.object({
  id: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  competitorId: z.string().uuid().nullable().optional(),
  label: z.string().min(1).max(160).transform((v) => cleanText(v, 160)),
  url: z.string().min(1).max(500).transform((v) => {
    const ok = validPublicUrl(v);
    if (!ok) throw new Error("Source URL must be a public http(s) address.");
    return ok;
  }),
  kind: z.enum(["website", "directory", "reviews", "news", "social"]).default("website"),
});

const AlertRuleInput = z.object({
  id: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  ruleKind: z.enum(["rating_decline", "price_change", "new_opening", "promotion_change"]),
  enabled: z.boolean().default(true),
  threshold: z
    .record(z.string(), z.union([z.string().max(80), z.number(), z.boolean()]))
    .default({}),
});

const EventInput = z.object({
  id: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  competitorId: z.string().uuid().nullable().optional(),
  eventKind: z.enum(["new_opening", "closing", "development", "price_change", "promotion_change", "note"]),
  title: z.string().min(1).max(160).transform((v) => cleanText(v, 160)),
  detail: z.string().max(1000).nullable().optional().transform((v) => (v ? cleanText(v, 1000) : null)),
  sourceUrl: z.string().max(500).nullable().optional().transform((v) => (v ? validPublicUrl(v) : null)),
  sourceLabel: z.string().max(120).nullable().optional().transform((v) => (v ? cleanText(v, 120) : null)),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});

// ── Ownership guard ──────────────────────────────────────────────────────────

async function assertWorkspaceOwner(userId: string, businessId: string) {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select("id, business_name, location")
    .eq("id", businessId)
    .eq("user_id", userId)
    .limit(1);
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0];
  if (!row) throw new Error("Workspace not found for this account.");
  return row as { id: string; business_name: string; location: string };
}

// ── View types ───────────────────────────────────────────────────────────────

export type FactView = {
  value: string | null;
  status: "reported" | "unknown" | "unavailable";
  sourceUrl: string | null;
  sourceLabel: string | null;
  effectiveDate: string | null;
  needsReview: boolean;
  updatedAt: string;
};

const EMPTY_FACT: FactView = {
  value: null,
  status: "unknown",
  sourceUrl: null,
  sourceLabel: null,
  effectiveDate: null,
  needsReview: false,
  updatedAt: "",
};

export type CompetitorProfile = {
  id: string;
  name: string;
  category: string | null;
  area: string | null;
  websiteUrl: string | null;
  googlePlaceId: string | null;
  notes: string | null;
  status: "open" | "closed" | "unknown";
  facts: Record<FactField, FactView>;
  updatedAt: string;
};

export type TrackedSourceRow = {
  id: string;
  competitorId: string | null;
  label: string;
  url: string;
  kind: string;
  status: "active" | "unreachable" | "needs_review";
  lastCheckedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
};

export type AlertRuleRow = {
  id: string;
  ruleKind: string;
  enabled: boolean;
  threshold: Record<string, string | number | boolean>;
};

export type CompetitorEventRow = {
  id: string;
  competitorId: string | null;
  eventKind: string;
  title: string;
  detail: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  occurredAt: string;
};

export type BriefRow = {
  id: string;
  businessId: string | null;
  businessName: string;
  location: string;
  status: "draft" | "published";
  weekStart: string | null;
  brief: Json;
  createdAt: string;
  emailedAt: string | null;
};

function emptyFacts(): Record<FactField, FactView> {
  return {
    price_signal: { ...EMPTY_FACT },
    promotion: { ...EMPTY_FACT },
    rating: { ...EMPTY_FACT },
    hours: { ...EMPTY_FACT },
    social_activity: { ...EMPTY_FACT },
    openings: { ...EMPTY_FACT },
    other: { ...EMPTY_FACT },
  };
}

// ── Competitors ──────────────────────────────────────────────────────────────

export const listCompetitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ businessId: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<{ competitors: CompetitorProfile[] }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);

    const [{ data: comps, error }, { data: facts }] = await Promise.all([
      supabaseAdmin
        .from("competitors")
        .select("*")
        .eq("business_id", data.businessId)
        .order("name", { ascending: true })
        .limit(200),
      supabaseAdmin
        .from("competitor_facts")
        .select("*")
        .eq("business_id", data.businessId),
    ]);
    if (error) throw new Error(error.message);

    const factsByCompetitor = new Map<string, Partial<Record<FactField, FactView>>>();
    for (const f of facts ?? []) {
      const row = f as {
        competitor_id: string;
        field: string;
        value: string | null;
        status: string;
        source_url: string | null;
        source_label: string | null;
        effective_date: string | null;
        needs_review: boolean;
        updated_at: string;
      };
      if (!FACT_FIELDS.includes(row.field as FactField)) continue;
      const list = factsByCompetitor.get(row.competitor_id) ?? {};
      list[row.field as FactField] = {
        value: row.value,
        status: (row.status as FactView["status"]) ?? "unknown",
        sourceUrl: row.source_url,
        sourceLabel: row.source_label,
        effectiveDate: row.effective_date,
        needsReview: row.needs_review,
        updatedAt: row.updated_at,
      };
      factsByCompetitor.set(row.competitor_id, list);
    }

    return {
      competitors: (comps ?? []).map((c) => {
        const row = c as {
          id: string;
          name: string;
          category: string | null;
          area: string | null;
          website_url: string | null;
          google_place_id: string | null;
          notes: string | null;
          status: string;
          updated_at: string;
        };
        const extra = factsByCompetitor.get(row.id) ?? {};
        const merged = emptyFacts();
        for (const field of FACT_FIELDS) {
          const found = extra[field];
          if (found) merged[field] = found;
        }
        return {
          id: row.id,
          name: row.name,
          category: row.category,
          area: row.area,
          websiteUrl: row.website_url,
          googlePlaceId: row.google_place_id,
          notes: row.notes,
          status: (row.status as CompetitorProfile["status"]) ?? "open",
          facts: merged,
          updatedAt: row.updated_at,
        } satisfies CompetitorProfile;
      }),
    };
  });

export const saveCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(CompetitorInput.parse)
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const now = new Date().toISOString();

    const base = {
      user_id: context.userId,
      business_id: data.businessId,
      name: data.name,
      category: data.category,
      area: data.area,
      website_url: data.websiteUrl,
      google_place_id: data.googlePlaceId,
      notes: data.notes,
      status: data.status,
      updated_at: now,
    };

    let competitorId = data.id ?? null;
    if (competitorId) {
      // Verify the existing competitor belongs to this workspace before update.
      const { data: owned } = await supabaseAdmin
        .from("competitors")
        .select("id")
        .eq("id", competitorId)
        .eq("business_id", data.businessId)
        .eq("user_id", context.userId)
        .limit(1);
      if (!owned || owned.length === 0) throw new Error("Competitor not found.");
      const { error } = await supabaseAdmin
        .from("competitors")
        .update(base)
        .eq("id", competitorId);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("competitors")
        .insert(base)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      competitorId = (inserted as { id: string }).id;
    }

    // Upsert provided facts; facts absent from the payload are left untouched.
    if (data.facts.length > 0 && competitorId) {
      const { data: existing } = await supabaseAdmin
        .from("competitor_facts")
        .select("id, field")
        .eq("competitor_id", competitorId);
      const byField = new Map<string, string>(
        (existing ?? []).map((r) => [(r as { field: string }).field, (r as { id: string }).id]),
      );
      for (const fact of data.facts) {
        const payload = {
          competitor_id: competitorId,
          user_id: context.userId,
          business_id: data.businessId,
          field: fact.field,
          value: fact.value,
          status: fact.status,
          source_url: fact.sourceUrl,
          source_label: fact.sourceLabel,
          effective_date: fact.effectiveDate,
          needs_review: fact.needsReview,
          updated_at: now,
        };
        const existingId = byField.get(fact.field);
        if (existingId) {
          await supabaseAdmin.from("competitor_facts").update(payload).eq("id", existingId);
        } else {
          await supabaseAdmin.from("competitor_facts").insert(payload);
        }
      }
    }

    return { id: competitorId ?? "" };
  });

export const deleteCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ businessId: z.string().uuid(), id: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const { error } = await supabaseAdmin
      .from("competitors")
      .delete()
      .eq("id", data.id)
      .eq("business_id", data.businessId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Tracked sources ──────────────────────────────────────────────────────────

export const listTrackedSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ businessId: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<{ sources: TrackedSourceRow[] }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const { data: rows, error } = await supabaseAdmin
      .from("tracked_sources")
      .select("*")
      .eq("business_id", data.businessId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return {
      sources: (rows ?? []).map((s) => {
        const r = s as {
          id: string;
          competitor_id: string | null;
          label: string;
          url: string;
          kind: string;
          status: string;
          last_checked_at: string | null;
          last_ok_at: string | null;
          last_error: string | null;
        };
        return {
          id: r.id,
          competitorId: r.competitor_id,
          label: r.label,
          url: r.url,
          kind: r.kind,
          status: (r.status as TrackedSourceRow["status"]) ?? "active",
          lastCheckedAt: r.last_checked_at,
          lastOkAt: r.last_ok_at,
          lastError: r.last_error,
        };
      }),
    };
  });

export const saveTrackedSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(SourceInput.parse)
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const now = new Date().toISOString();
    const base = {
      user_id: context.userId,
      business_id: data.businessId,
      competitor_id: data.competitorId ?? null,
      label: data.label,
      url: data.url,
      kind: data.kind,
      updated_at: now,
    };
    if (data.id) {
      const { data: owned } = await supabaseAdmin
        .from("tracked_sources")
        .select("id")
        .eq("id", data.id)
        .eq("business_id", data.businessId)
        .eq("user_id", context.userId)
        .limit(1);
      if (!owned || owned.length === 0) throw new Error("Source not found.");
      const { error } = await supabaseAdmin
        .from("tracked_sources")
        .update(base)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await supabaseAdmin
      .from("tracked_sources")
      .insert(base)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (inserted as { id: string }).id };
  });

export const deleteTrackedSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ businessId: z.string().uuid(), id: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const { error } = await supabaseAdmin
      .from("tracked_sources")
      .delete()
      .eq("id", data.id)
      .eq("business_id", data.businessId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Health check: HEAD first, GET fallback; 8s timeout; three attempts before
// declaring a source unreachable. Results are cached briefly so mashing the
// button can't be used to turn the server into a request cannon.
type HealthOutcome = { status: "active" | "unreachable" | "needs_review"; error: string | null; httpStatus: number | null };

async function probeUrl(url: string): Promise<HealthOutcome> {
  if (!isPublicWebsiteUrl(url)) {
    return { status: "needs_review", error: "URL is not a public address.", httpStatus: null };
  }
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "theBizScope/1.0 (source health check)" },
      });
      if (res.status >= 200 && res.status < 400) {
        return { status: "active", error: null, httpStatus: res.status };
      }
      // Some servers reject HEAD — retry the same attempt with GET before
      // counting it as a failure.
      const getRes = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "theBizScope/1.0 (source health check)" },
      });
      if (getRes.status >= 200 && getRes.status < 400) {
        return { status: "active", error: null, httpStatus: getRes.status };
      }
      return {
        status: "needs_review",
        error: `HTTP ${getRes.status}`,
        httpStatus: getRes.status,
      };
    } catch (err) {
      if (i === attempts - 1) {
        const message = err instanceof Error ? err.message : "network error";
        return { status: "unreachable", error: message.slice(0, 200), httpStatus: null };
      }
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: "unreachable", error: "unreachable", httpStatus: null };
}

export const checkSourceHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ businessId: z.string().uuid(), id: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<{ outcome: HealthOutcome }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const cacheKey = `src-health:${data.id}`;
    const cached = cacheGet<HealthOutcome>(cacheKey);
    const outcome =
      cached ??
      (await (async () => {
        const { data: rows } = await supabaseAdmin
          .from("tracked_sources")
          .select("url")
          .eq("id", data.id)
          .eq("business_id", data.businessId)
          .eq("user_id", context.userId)
          .limit(1);
        const row = (rows ?? [])[0] as { url: string } | undefined;
        if (!row) throw new Error("Source not found.");
        const result = await probeUrl(row.url);
        cacheSet(cacheKey, result, 60_000);
        return result;
      })());

    const now = new Date().toISOString();
    const updateRow =
      outcome.status === "active"
        ? {
            status: outcome.status,
            last_checked_at: now,
            last_ok_at: now,
            last_error: outcome.error,
            updated_at: now,
          }
        : {
            status: outcome.status,
            last_checked_at: now,
            last_error: outcome.error,
            updated_at: now,
          };
    await supabaseAdmin.from("tracked_sources").update(updateRow).eq("id", data.id).eq("business_id", data.businessId);
    return { outcome };
  });

// ── Alert rules ──────────────────────────────────────────────────────────────

export const listAlertRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ businessId: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<{ rules: AlertRuleRow[] }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const { data: rows, error } = await supabaseAdmin
      .from("alert_rules")
      .select("*")
      .eq("business_id", data.businessId)
      .order("rule_kind", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      rules: (rows ?? []).map((r) => {
        const row = r as {
          id: string;
          rule_kind: string;
          enabled: boolean;
          threshold: unknown;
        };
        return {
          id: row.id,
          ruleKind: row.rule_kind,
          enabled: row.enabled,
          threshold: (row.threshold ?? {}) as AlertRuleRow["threshold"],
        };
      }),
    };
  });

export const saveAlertRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(AlertRuleInput.parse)
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const now = new Date().toISOString();
    // One rule per kind per workspace — upsert semantics.
    const { data: existing } = await supabaseAdmin
      .from("alert_rules")
      .select("id")
      .eq("business_id", data.businessId)
      .eq("rule_kind", data.ruleKind)
      .limit(1);
    const existingId = (existing ?? [])[0] as { id: string } | undefined;
    if (existingId) {
      const { error } = await supabaseAdmin
        .from("alert_rules")
        .update({ enabled: data.enabled, threshold: data.threshold, updated_at: now })
        .eq("id", existingId.id);
      if (error) throw new Error(error.message);
      return { id: existingId.id };
    }
    const { data: inserted, error } = await supabaseAdmin
      .from("alert_rules")
      .insert({
        user_id: context.userId,
        business_id: data.businessId,
        rule_kind: data.ruleKind,
        enabled: data.enabled,
        threshold: data.threshold,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (inserted as { id: string }).id };
  });

export const deleteAlertRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ businessId: z.string().uuid(), id: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const { error } = await supabaseAdmin
      .from("alert_rules")
      .delete()
      .eq("id", data.id)
      .eq("business_id", data.businessId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Competitor events (neighbourhood change feed) ────────────────────────────

export const listCompetitorEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ businessId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(50) }).parse)
  .handler(async ({ data, context }): Promise<{ events: CompetitorEventRow[] }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const { data: rows, error } = await supabaseAdmin
      .from("competitor_events")
      .select("*")
      .eq("business_id", data.businessId)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return {
      events: (rows ?? []).map((e) => {
        const r = e as {
          id: string;
          competitor_id: string | null;
          event_kind: string;
          title: string;
          detail: string | null;
          source_url: string | null;
          source_label: string | null;
          occurred_at: string;
        };
        return {
          id: r.id,
          competitorId: r.competitor_id,
          eventKind: r.event_kind,
          title: r.title,
          detail: r.detail,
          sourceUrl: r.source_url,
          sourceLabel: r.source_label,
          occurredAt: r.occurred_at,
        };
      }),
    };
  });

export const saveCompetitorEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(EventInput.parse)
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const payload = {
      user_id: context.userId,
      business_id: data.businessId,
      competitor_id: data.competitorId ?? null,
      event_kind: data.eventKind,
      title: data.title,
      detail: data.detail,
      source_url: data.sourceUrl,
      source_label: data.sourceLabel,
      occurred_at: data.occurredAt ?? new Date().toISOString(),
    };
    if (data.id) {
      const { data: owned } = await supabaseAdmin
        .from("competitor_events")
        .select("id")
        .eq("id", data.id)
        .eq("business_id", data.businessId)
        .eq("user_id", context.userId)
        .limit(1);
      if (!owned || owned.length === 0) throw new Error("Event not found.");
      const { error } = await supabaseAdmin
        .from("competitor_events")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await supabaseAdmin
      .from("competitor_events")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (inserted as { id: string }).id };
  });

export const deleteCompetitorEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ businessId: z.string().uuid(), id: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const { error } = await supabaseAdmin
      .from("competitor_events")
      .delete()
      .eq("id", data.id)
      .eq("business_id", data.businessId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Briefs: draft → review → publish ─────────────────────────────────────────

const BriefSourceSchema = z.object({
  label: z.string().max(160).transform((v) => cleanText(v, 160)),
  url: z.string().max(500).transform((v) => {
    const ok = validPublicUrl(v);
    if (!ok) throw new Error("Source URL must be a public http(s) address.");
    return ok;
  }),
  kind: z.enum(["directory", "website", "reviews", "news", "social"]).default("website"),
});

const BriefContentSchema = z.object({
  title: z.string().max(200).optional().transform((v) => (v ? cleanText(v, 200) : undefined)),
  intro: z.string().max(2000).optional().transform((v) => (v ? cleanText(v, 2000) : undefined)),
  signals: z
    .array(
      z.object({
        tone: z.enum(["green", "amber", "red", "neutral"]).catch("neutral"),
        label: z.string().max(80).transform((v) => cleanText(v, 80)),
        headline: z.string().max(200).transform((v) => cleanText(v, 200)),
        detail: z.string().max(1000).transform((v) => cleanText(v, 1000)),
      }),
    )
    .max(12)
    .default([]),
  sources: z.array(BriefSourceSchema).max(20).default([]),
});

const SaveDraftInput = z.object({
  businessId: z.string().uuid(),
  brief: BriefContentSchema,
  weekStart: z.string().regex(DATE_RE).optional(),
});

export const listWorkspaceBriefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ businessId: z.string().uuid(), includeDrafts: z.boolean().default(true) }).parse)
  .handler(async ({ data, context }): Promise<{ briefs: BriefRow[] }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    let query = supabaseAdmin
      .from("briefs")
      .select("id, business_id, business_name, location, status, week_start, brief, created_at, emailed_at")
      .eq("business_id", data.businessId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (!data.includeDrafts) query = query.eq("status", "published");
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return {
      briefs: (rows ?? []).map((b) => {
        const r = b as {
          id: string;
          business_id: string | null;
          business_name: string;
          location: string;
          status: string;
          week_start: string | null;
          brief: unknown;
          created_at: string;
          emailed_at: string | null;
        };
        return {
          id: r.id,
          businessId: r.business_id,
          businessName: r.business_name,
          location: r.location,
          status: (r.status as BriefRow["status"]) ?? "published",
          weekStart: r.week_start,
          brief: r.brief as Json,
          createdAt: r.created_at,
          emailedAt: r.emailed_at,
        };
      }),
    };
  });

export const saveBriefDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(SaveDraftInput.parse)
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const business = await assertWorkspaceOwner(context.userId, data.businessId);
    const { data: inserted, error } = await supabaseAdmin
      .from("briefs")
      .insert({
        user_id: context.userId,
        business_id: data.businessId,
        business_name: business.business_name,
        business_type: "other",
        location: business.location,
        status: "draft",
        week_start: data.weekStart ?? new Date().toISOString().slice(0, 10),
        brief: data.brief as unknown as Json,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (inserted as { id: string }).id };
  });

export const updateBriefDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: z.string().uuid(), businessId: z.string().uuid(), brief: BriefContentSchema }).parse)
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    // Only drafts are editable — published briefs are immutable history.
    const { error } = await supabaseAdmin
      .from("briefs")
      .update({ brief: data.brief as unknown as Json })
      .eq("id", data.id)
      .eq("business_id", data.businessId)
      .eq("user_id", context.userId)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const publishBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: z.string().uuid(), businessId: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const { error } = await supabaseAdmin
      .from("briefs")
      .update({ status: "published" })
      .eq("id", data.id)
      .eq("business_id", data.businessId)
      .eq("user_id", context.userId)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: z.string().uuid(), businessId: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await assertWorkspaceOwner(context.userId, data.businessId);
    const { error } = await supabaseAdmin
      .from("briefs")
      .delete()
      .eq("id", data.id)
      .eq("business_id", data.businessId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
