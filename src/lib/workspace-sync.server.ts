// Scan → workspace sync. Turns a ResearchSnapshot's competitors into
// workspace records (competitors + competitor_facts).
//
// Merge policy: manual entries always win. A scan never overwrites a manually
// entered fact. It fills gaps (fields with no fact or status='unknown'),
// refreshes its own previously scanned values, and flags genuine value
// changes with needs_review so the user confirms them. Pure merge logic is
// separated from DB access so the rules are unit-testable.

import type { ResearchSnapshot } from "@/lib/local-research.server";

// ── Pure helpers ─────────────────────────────────────────────────────────────

const MAX_NAME = 120;

export type ExistingFactLike = {
  status: string;
  origin: string;
  value: string | null;
};

export type ScanFactDraft = {
  field: string;
  value: string;
  source_url: string | null;
  source_label: string | null;
  effective_date: string | null;
};

export type ScanCompetitorDraft = {
  name: string;
  area: string | null;
  website_url: string | null;
  facts: ScanFactDraft[];
};

export type SyncStats = {
  created: number;
  updatedFacts: number;
  flagged: number;
  skipped: number;
};

export type SyncResult = SyncStats & { errors: string[] };

// Workspace names are capped at 120 chars; scans return full listing names.
// Truncation happens at a word boundary when possible.
export function scanNameForWorkspace(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (cleaned.length <= MAX_NAME) return cleaned;
  const cut = cleaned.slice(0, MAX_NAME);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > MAX_NAME * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

// Normalize names for dedupe: lowercase, strip punctuation and generic
// business words so "Studio Lime" and "studio lime hair" collapse together.
export function normalizeName(raw: string): string {
  const cleaned = scanNameForWorkspace(raw)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(
      /\b(inc|llc|ltd|gmbh|ab|oy|aps|bv|sa|srl|salon|spa|barber|barbershop|studio|shop|store|the|and|of)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : scanNameForWorkspace(raw).toLowerCase();
}

// Google price_level ("0".."4") → human phrase. Unparseable stays null.
export function priceLevelToPhrase(level: string | null | undefined): string | null {
  if (!level) return null;
  const num = Number(level);
  if (!Number.isFinite(num)) return null;
  const phrases = ["budget", "moderate", "moderate", "premium", "premium"];
  return phrases[Math.max(0, Math.min(4, Math.round(num)))] ?? null;
}

function ratingDisplay(rating: number): string {
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
}

// Extract workspace facts from one scan competitor. Every fact carries the
// scan's own source attribution and the capture date.
export function factsFromScanCompetitor(
  competitor: {
    openingHours?: string | undefined;
    priceLevel?: string | undefined;
    priceSamples: string[];
    rating?: number | undefined;
    reviewCount?: number | undefined;
    openingDate?: string | undefined;
    sourceUrl: string;
    sourceLabel: string;
  },
  capturedAt: string,
): ScanFactDraft[] {
  const date = capturedAt.slice(0, 10);
  const facts: ScanFactDraft[] = [];

  if (typeof competitor.rating === "number" && Number.isFinite(competitor.rating)) {
    facts.push({
      field: "rating",
      value:
        typeof competitor.reviewCount === "number"
          ? `${ratingDisplay(competitor.rating)} (${competitor.reviewCount} reviews)`
          : ratingDisplay(competitor.rating),
      source_url: competitor.sourceUrl,
      source_label: competitor.sourceLabel,
      effective_date: date,
    });
  }

  const price =
    priceLevelToPhrase(competitor.priceLevel) ??
    (competitor.priceSamples.length > 0
      ? competitor.priceSamples.slice(0, 3).join(" · ")
      : null);
  if (price) {
    facts.push({
      field: "price_signal",
      value: price,
      source_url: competitor.sourceUrl,
      source_label: competitor.sourceLabel,
      effective_date: date,
    });
  }

  if (competitor.openingHours) {
    facts.push({
      field: "hours",
      value: competitor.openingHours,
      source_url: competitor.sourceUrl,
      source_label: competitor.sourceLabel,
      effective_date: date,
    });
  }

  if (competitor.openingDate) {
    facts.push({
      field: "openings",
      value: `Announced opening: ${competitor.openingDate}`,
      source_url: competitor.sourceUrl,
      source_label: competitor.sourceLabel,
      effective_date: date,
    });
  }

  return facts;
}

// The merge decision. Given the existing fact (if any) and the scanned value:
// - no existing fact or explicitly unknown → "create" (scan fills the gap)
// - manually entered                       → "skip" (manual wins, always)
// - confirmed not published                → "skip" (user said they don't share it)
// - scan-sourced, same value               → "skip" (nothing changed)
// - scan-sourced, different value          → "flag" (refresh + needs_review)
export function mergeFact(
  existing: ExistingFactLike | null | undefined,
  incoming: ScanFactDraft,
): "create" | "flag" | "skip" {
  if (!existing || existing.status === "unknown") return "create";
  if (existing.origin === "manual") return "skip";
  if (existing.status === "unavailable") return "skip";
  if (existing.status === "reported") {
    return existing.value !== incoming.value ? "flag" : "skip";
  }
  return "skip";
}

// Derive the workspace draft for one scan competitor (pure — no DB).
export function competitorDraftFromScan(
  competitor: {
    name: string;
    address?: string | undefined;
    website?: string | undefined;
    openingHours?: string | undefined;
    priceLevel?: string | undefined;
    priceSamples: string[];
    rating?: number | undefined;
    reviewCount?: number | undefined;
    openingDate?: string | undefined;
    sourceUrl: string;
    sourceLabel: string;
  },
  capturedAt: string,
): ScanCompetitorDraft {
  return {
    name: scanNameForWorkspace(competitor.name),
    area: competitor.address
      ? (competitor.address.split(",").slice(-2, -1)[0]?.trim() ?? null) || null
      : null,
    website_url: competitor.website ?? null,
    facts: factsFromScanCompetitor(competitor, capturedAt),
  };
}

// ── DB sync ──────────────────────────────────────────────────────────────────

// Minimal structural type so both the service-role client (cron) and the
// authed client (on-demand scan) can be passed in.
type AnySupabase = { from: (table: string) => any };

export async function syncScanToWorkspace(
  supabase: AnySupabase,
  businessId: string,
  userId: string,
  research: ResearchSnapshot,
): Promise<SyncResult> {
  const stats: SyncStats = { created: 0, updatedFacts: 0, flagged: 0, skipped: 0 };
  const errors: string[] = [];
  const now = new Date().toISOString();

  // Load existing competitors once and match in JS by normalized name —
  // avoids per-competitor lookups and SQL-expression matching entirely.
  const { data: existingCompetitors, error: loadError } = await supabase
    .from("competitors")
    .select("id, name")
    .eq("business_id", businessId)
    .limit(500);
  if (loadError) {
    return { ...stats, errors: [`load competitors: ${loadError.message}`] };
  }
  const byNormalized = new Map<string, string>();
  for (const row of existingCompetitors ?? []) {
    const r = row as { id: string; name: string };
    byNormalized.set(normalizeName(r.name), r.id);
  }

  for (const competitor of research.competitors.slice(0, 30)) {
    try {
      const draft = competitorDraftFromScan(competitor, research.capturedAt);
      const norm = normalizeName(competitor.name);
      if (!norm) {
        stats.skipped++;
        continue;
      }

      let competitorId = byNormalized.get(norm) ?? null;

      if (!competitorId) {
        const { data: inserted, error } = await supabase
          .from("competitors")
          .insert({
            user_id: userId,
            business_id: businessId,
            name: draft.name,
            area: draft.area,
            website_url: draft.website_url,
            status: "open",
            updated_at: now,
          })
          .select("id")
          .single();
        if (error || !inserted) {
          errors.push(`insert competitor "${draft.name}": ${error?.message ?? "no row"}`);
          stats.skipped++;
          continue;
        }
        competitorId = (inserted as { id: string }).id;
        byNormalized.set(norm, competitorId);
        stats.created++;
      }

      if (!competitorId) continue;

      // Existing facts for this competitor, by field.
      const { data: existingFacts, error: factsError } = await supabase
        .from("competitor_facts")
        .select("id, field, status, origin, value")
        .eq("competitor_id", competitorId);
      if (factsError) {
        errors.push(`load facts for "${draft.name}": ${factsError.message}`);
        continue;
      }
      const factByField = new Map<string, { id: string; status: string; origin: string; value: string | null }>();
      for (const row of existingFacts ?? []) {
        const r = row as { id: string; field: string; status: string; origin: string; value: string | null };
        factByField.set(r.field, r);
      }

      for (const fact of draft.facts) {
        const existing = factByField.get(fact.field);
        const action = mergeFact(
          existing
            ? { status: existing.status, origin: existing.origin, value: existing.value }
            : null,
          fact,
        );

        if (action === "create") {
          const { error } = await supabase.from("competitor_facts").insert({
            competitor_id: competitorId,
            user_id: userId,
            business_id: businessId,
            field: fact.field,
            value: fact.value,
            status: "reported",
            origin: "scan",
            source_url: fact.source_url,
            source_label: fact.source_label,
            effective_date: fact.effective_date,
            needs_review: false,
            updated_at: now,
          });
          if (error) {
            errors.push(`insert fact ${fact.field} for "${draft.name}": ${error.message}`);
            continue;
          }
          stats.updatedFacts++;
        } else if (action === "flag" && existing) {
          // Scan-sourced value changed since last scan: refresh it and ask
          // the user to confirm (needs_review). Manual rows never reach here.
          const { error } = await supabase
            .from("competitor_facts")
            .update({
              value: fact.value,
              source_url: fact.source_url,
              source_label: fact.source_label,
              effective_date: fact.effective_date,
              needs_review: true,
              updated_at: now,
            })
            .eq("id", existing.id);
          if (error) {
            errors.push(`flag fact ${fact.field} for "${draft.name}": ${error.message}`);
            continue;
          }
          stats.flagged++;
        } else {
          stats.skipped++;
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "unknown sync error");
    }
  }

  return { ...stats, errors };
}
