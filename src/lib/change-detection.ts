import { z } from "zod";

// Pure, client-safe module: diff engine that turns consecutive research
// snapshots into honest, structured "what changed" facts. No network, no
// server APIs — fully unit-testable.

export type ChangeTone = "red" | "amber" | "green";

export type DetectedChange = {
  tone: ChangeTone;
  kind: "price" | "reviews" | "hours" | "new_entry";
  headline: string;
  detail: string;
  competitorName?: string | undefined;
  sourceLabel?: string | undefined;
};

export const DetectedChangeSchema = z.object({
  tone: z.enum(["red", "amber", "green"]),
  kind: z.enum(["price", "reviews", "hours", "new_entry"]),
  headline: z.string(),
  detail: z.string(),
  competitorName: z.string().optional(),
  sourceLabel: z.string().optional(),
});

export function parseDetectedChanges(value: unknown): DetectedChange[] {
  if (!Array.isArray(value)) return [];
  const parsed: DetectedChange[] = [];
  for (const item of value) {
    const result = DetectedChangeSchema.safeParse(item);
    if (result.success) parsed.push(result.data);
  }
  return parsed;
}

// --- ResearchSnapshot runtime shape (JSONB round-trip) ---
// Mirrors the ResearchSnapshot type in local-research.server.ts so stored
// snapshots can be re-parsed safely before diffing.
export const ResearchSnapshotSchema = z.object({
  location: z.object({
    displayName: z.string(),
    latitude: z.number(),
    longitude: z.number(),
  }),
  competitors: z.array(
    z.object({
      name: z.string(),
      distanceMeters: z.number(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      address: z.string().optional(),
      website: z.string().optional(),
      phone: z.string().optional(),
      openingHours: z.string().optional(),
      openingDate: z.string().optional(),
      priceLevel: z.string().optional(),
      priceSamples: z.array(z.string()),
      rating: z.number().optional(),
      reviewCount: z.number().optional(),
      reviewQuote: z.string().optional(),
      sourceUrl: z.string(),
      sourceLabel: z.string(),
    }),
  ),
  sources: z.array(z.object({ label: z.string(), url: z.string(), kind: z.string() })),
  warnings: z.array(z.string()),
  capturedAt: z.string(),
});

export type ResearchSnapshot = z.infer<typeof ResearchSnapshotSchema>;
export type Competitor = ResearchSnapshot["competitors"][number];

export function parseResearchSnapshot(value: unknown): ResearchSnapshot | null {
  const parsed = ResearchSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// --- Identity matching (kept in sync with isSameCompetitor in
// local-research.server.ts — same rules: name match plus coordinates within
// 150 m, or a distance delta within 250 m when coordinates are missing). ---

function normalizeName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|salon|spa|ltd|limited|llc|inc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesLikelyMatch(a: string, b: string): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

function distanceInMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const earthRadius = 6_371_000;
  const radians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = radians(bLat - aLat);
  const deltaLon = radians(bLon - aLon);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(deltaLon / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function sameBusiness(a: Competitor, b: Competitor): boolean {
  if (!namesLikelyMatch(a.name, b.name)) return false;
  if (
    a.latitude !== undefined &&
    a.longitude !== undefined &&
    b.latitude !== undefined &&
    b.longitude !== undefined
  ) {
    return distanceInMeters(a.latitude, a.longitude, b.latitude, b.longitude) <= 150;
  }
  return Math.abs(a.distanceMeters - b.distanceMeters) <= 250;
}

// --- Price parsing (same-currency numeric comparisons only) ---

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR", "₹": "INR" };

export function parsePrice(value: string): { amount: number; currency: string } | null {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const match = /^(?:([$£€₹])\s?|(USD|GBP|EUR|INR)\s?)(\d{1,4}(?:[.,]\d{1,2})?)$/i.exec(trimmed);
  if (!match) return null;
  const symbol = match[1];
  const code = (symbol ? CURRENCY_SYMBOLS[symbol] : match[2]) as string | undefined;
  if (!code) return null;
  const amount = Number((match[3] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: code.toUpperCase() };
}

function sortedPrices(prices: string[]): string[] {
  return [...new Set(prices.map((p) => p.trim()).filter(Boolean))].sort();
}

function samePrices(a: string[], b: string[]): boolean {
  const left = sortedPrices(a);
  const right = sortedPrices(b);
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

// --- Change detection ---

const MAX_CHANGES = 8;
const MIN_RATING_DELTA = 0.05;
const MAX_NEW_ENTRIES = 3;

function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
}

function findPrevious(previous: Competitor[], candidate: Competitor): Competitor | undefined {
  return previous.find((p) => sameBusiness(p, candidate));
}

export function detectChanges(
  previous: ResearchSnapshot | null,
  current: ResearchSnapshot,
): DetectedChange[] {
  // No baseline yet — this run only establishes history. Nothing can be
  // claimed as a change without a prior scan.
  if (!previous) return [];

  const changes: DetectedChange[] = [];
  const seen = new Set<string>();

  const push = (change: DetectedChange) => {
    if (changes.length >= MAX_CHANGES) return;
    if (seen.has(change.headline)) return;
    seen.add(change.headline);
    changes.push(change);
  };

  let newEntries = 0;
  for (const competitor of current.competitors) {
    const prior = findPrevious(previous.competitors, competitor);

    if (!prior) {
      // First observation of this business since the baseline was set. Phrase
      // it as "first appeared in our scans", never as a claim it "opened".
      if (newEntries >= MAX_NEW_ENTRIES) continue;
      newEntries += 1;
      push({
        tone: "amber",
        kind: "new_entry",
        competitorName: competitor.name,
        sourceLabel: competitor.sourceLabel,
        headline: `${competitor.name} first appeared in our scans`,
        detail: `${formatDistance(competitor.distanceMeters)} from you · found via ${competitor.sourceLabel}`,
      });
      continue;
    }

    // Prices
    const pricesChanged = !samePrices(prior.priceSamples, competitor.priceSamples);
    if (pricesChanged) {
      const oldPrice = parsePrice(prior.priceSamples[0] ?? "");
      const newPrice = parsePrice(competitor.priceSamples[0] ?? "");
      if (
        prior.priceSamples.length === 1 &&
        competitor.priceSamples.length === 1 &&
        oldPrice &&
        newPrice &&
        oldPrice.currency === newPrice.currency &&
        oldPrice.amount !== newPrice.amount
      ) {
        const dropped = newPrice.amount < oldPrice.amount;
        push({
          tone: dropped ? "red" : "green",
          kind: "price",
          competitorName: competitor.name,
          sourceLabel: competitor.sourceLabel,
          headline: `${competitor.name} ${dropped ? "cut" : "raised"} its headline price to ${competitor.priceSamples[0]}`,
          detail: `${prior.priceSamples[0]} → ${competitor.priceSamples[0]} · source: ${competitor.sourceLabel}`,
        });
      } else {
        push({
          tone: "amber",
          kind: "price",
          competitorName: competitor.name,
          sourceLabel: competitor.sourceLabel,
          headline: `${competitor.name} updated its published prices`,
          detail: `${prior.priceSamples.length} item${prior.priceSamples.length === 1 ? "" : "s"} → ${competitor.priceSamples.length} item${competitor.priceSamples.length === 1 ? "" : "s"} · source: ${competitor.sourceLabel}`,
        });
      }
    } else if (
      prior.priceLevel &&
      competitor.priceLevel &&
      prior.priceLevel !== competitor.priceLevel
    ) {
      push({
        tone: "amber",
        kind: "price",
        competitorName: competitor.name,
        sourceLabel: competitor.sourceLabel,
        headline: `${competitor.name} changed its price level`,
        detail: `${prior.priceLevel} → ${competitor.priceLevel} · source: ${competitor.sourceLabel}`,
      });
    }

    // Reviews: rating, count, and the surfaced review quote.
    if (
      prior.rating !== undefined &&
      competitor.rating !== undefined &&
      Math.abs(competitor.rating - prior.rating) >= MIN_RATING_DELTA
    ) {
      const improved = competitor.rating > prior.rating;
      push({
        tone: "amber",
        kind: "reviews",
        competitorName: competitor.name,
        sourceLabel: competitor.sourceLabel,
        headline: `${competitor.name}'s rating ${improved ? "rose" : "fell"} to ${competitor.rating.toFixed(1)}/5`,
        detail: `${prior.rating.toFixed(1)} → ${competitor.rating.toFixed(1)} · source: ${competitor.sourceLabel}`,
      });
    }
    if (
      prior.reviewCount !== undefined &&
      competitor.reviewCount !== undefined &&
      competitor.reviewCount !== prior.reviewCount
    ) {
      const delta = competitor.reviewCount - prior.reviewCount;
      if (Math.abs(delta) >= 1) {
        push({
          tone: "amber",
          kind: "reviews",
          competitorName: competitor.name,
          sourceLabel: competitor.sourceLabel,
          headline: `${competitor.name} now shows ${competitor.reviewCount} ratings`,
          detail: `${delta > 0 ? "+" : ""}${delta} since the last scan · source: ${competitor.sourceLabel}`,
        });
      }
    }
    if (
      prior.reviewQuote &&
      competitor.reviewQuote &&
      prior.reviewQuote !== competitor.reviewQuote
    ) {
      push({
        tone: "amber",
        kind: "reviews",
        competitorName: competitor.name,
        sourceLabel: competitor.sourceLabel,
        headline: `${competitor.name} has a new review highlight`,
        detail: `“${competitor.reviewQuote.slice(0, 140)}” · source: ${competitor.sourceLabel}`,
      });
    }

    // Hours
    if (
      prior.openingHours &&
      competitor.openingHours &&
      prior.openingHours !== competitor.openingHours
    ) {
      push({
        tone: "amber",
        kind: "hours",
        competitorName: competitor.name,
        sourceLabel: competitor.sourceLabel,
        headline: `${competitor.name} updated its opening hours`,
        detail: `Now: ${competitor.openingHours.slice(0, 140)} · source: ${competitor.sourceLabel}`,
      });
    }
  }

  // Most important first: red threats, then everything else, newest area
  // entries before attribute drift so a market change isn't buried.
  const rank = (change: DetectedChange) =>
    (change.tone === "red" ? 0 : change.tone === "amber" ? 1 : 2) * 10 +
    (change.kind === "new_entry" ? 0 : 1);
  return changes.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_CHANGES);
}

// --- Rendering detected changes as brief signals ---

export type BriefSignal = {
  tone: ChangeTone;
  label: string;
  headline: string;
  detail: string;
};

const KIND_LABELS: Record<DetectedChange["kind"], string> = {
  price: "Price move",
  reviews: "Reviews",
  hours: "Hours",
  new_entry: "New in area",
};

export function changesToBriefSignals(changes: DetectedChange[]): BriefSignal[] {
  return changes.slice(0, 3).map((change) => ({
    tone: change.tone,
    label: KIND_LABELS[change.kind],
    headline: change.headline,
    detail: change.detail,
  }));
}