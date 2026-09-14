import { z } from "zod";

// Pure, client-safe module: diff engine that turns consecutive research
// snapshots into honest, structured "what changed" facts. No network, no
// server APIs — fully unit-testable.

export type ChangeTone = "red" | "amber" | "green";

export type DetectedChange = {
  tone: ChangeTone;
  kind: "price" | "reviews" | "hours" | "new_entry" | "own_listing";
  headline: string;
  detail: string;
  competitorName?: string | undefined;
  sourceLabel?: string | undefined;
};

export const DetectedChangeSchema = z.object({
  tone: z.enum(["red", "amber", "green"]),
  kind: z.enum(["price", "reviews", "hours", "new_entry", "own_listing"]),
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
  ownListing: z
    .object({
      name: z.string(),
      placeId: z
        .string()
        .trim()
        .optional(),
      rating: z.number().optional(),
      reviewCount: z.number().optional(),
      url: z.string().optional(),
      address: z.string().optional(),
      reviews: z
        .array(
          z.object({
            rating: z.number().optional(),
            text: z.string().optional(),
            author: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
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
  // Persisted match pin (see local-research.server.ts); absent on snapshots
  // captured before this field existed.
  ownListingPlaceId: z.string().trim().optional(),
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

const NAME_STOPWORDS = /\b(the|salon|spa|ltd|limited|llc|inc)\b/g;

function normalizeName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/'s\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(NAME_STOPWORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(" ").filter(Boolean));
}

// Fraction of the larger name's tokens covered by the smaller name's tokens,
// with partial (0.75) credit for prefix/nickname matches like "sam" vs
// "samantha" and near-identical tokens like "raddiance" vs "radiance".
// Tolerates word order, dropped words, shortened first names, and typos —
// while keeping genuinely distinct names ("Hair Studio" vs "Nail Studio")
// apart, because whole-string edit distance would wrongly merge those.
function tokenCoverage(aTokens: Set<string>, bTokens: Set<string>): number {
  const larger = aTokens.size >= bTokens.size ? aTokens : bTokens;
  const smaller = aTokens === larger ? bTokens : aTokens;
  if (larger.size === 0) return 0;
  let matched = 0;
  for (const token of smaller) {
    if (larger.has(token)) {
      matched += 1;
      continue;
    }
    let best = 0;
    for (const other of larger) {
      const min = Math.min(token.length, other.length);
      if (min >= 3 && (token.startsWith(other) || other.startsWith(token))) {
        best = Math.max(best, 0.75);
        continue;
      }
      if (min >= 3 && editDistance(token, other) / Math.max(token.length, other.length) <= 0.25) {
        best = Math.max(best, 0.75);
      }
    }
    matched += best;
  }
  return matched / larger.size;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const insert = current[j - 1]! + 1;
      const remove = previous[j]! + 1;
      const replace = previous[j - 1]! + cost;
      current[j] = Math.min(insert, remove, replace);
    }
    previous = current;
  }
  return previous[b.length]!;
}

function namesLikelyMatch(a: string, b: string): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // A longer full name containing the shorter one ("Radiance" inside
  // "Radiance Studio"). Guarded by length so short words like "Anna" don't
  // collapse distinct names ("Anna Nails" vs "Anna Spa" -> "anna").
  if (Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  return tokenCoverage(tokenSet(left), tokenSet(right)) >= 0.6;
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
  const match = /^(?:([$£€₹])\s?|(USD|GBP|EUR|INR)\s?)(\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)$/i.exec(trimmed);
  if (!match) return null;
  const symbol = match[1];
  const code = (symbol ? CURRENCY_SYMBOLS[symbol] : match[2]) as string | undefined;
  if (!code) return null;
  const raw = match[3] ?? "";
  // A trailing comma followed by 1-2 digits with no other separator is a
  // European decimal comma ("€9,50"); otherwise commas are thousands separators.
  const lastComma = raw.lastIndexOf(",");
  const hasEarlierSeparator = lastComma !== -1 && /[.,]/.test(raw.slice(0, lastComma));
  const amount =
    lastComma !== -1 && !hasEarlierSeparator && /^\d{1,2}$/.test(raw.slice(lastComma + 1))
      ? Number(raw.replace(",", "."))
      : Number(raw.replace(/,/g, ""));
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

  // Your own listing — reputation drift on your own door matters more than a
  // competitor move, so it is reported alongside the field (kind
  // "own_listing"). Only fires once a baseline with an own listing exists.
  if (previous.ownListing && current.ownListing) {
    const beforeOwn = previous.ownListing;
    const afterOwn = current.ownListing;
    const source = "Google Places";
    if (
      beforeOwn.rating !== undefined &&
      afterOwn.rating !== undefined &&
      Math.abs(afterOwn.rating - beforeOwn.rating) >= MIN_RATING_DELTA
    ) {
      const improved = afterOwn.rating > beforeOwn.rating;
      push({
        tone: improved ? "green" : "red",
        kind: "own_listing",
        competitorName: afterOwn.name,
        sourceLabel: source,
        headline: `Your rating ${improved ? "rose" : "fell"} to ${afterOwn.rating.toFixed(1)}/5`,
        detail: `${beforeOwn.rating.toFixed(1)} → ${afterOwn.rating.toFixed(1)} · source: ${source}`,
      });
    }
    if (
      beforeOwn.reviewCount !== undefined &&
      afterOwn.reviewCount !== undefined &&
      afterOwn.reviewCount !== beforeOwn.reviewCount
    ) {
      const delta = afterOwn.reviewCount - beforeOwn.reviewCount;
      if (Math.abs(delta) >= 1) {
        push({
          tone: delta > 0 ? "green" : "red",
          kind: "own_listing",
          competitorName: afterOwn.name,
          sourceLabel: source,
          headline: `Your listing now shows ${afterOwn.reviewCount} ratings`,
          detail: `${delta > 0 ? "+" : ""}${delta} since the last scan · source: ${source}`,
        });
      }
    }
    const knownTexts = new Set((beforeOwn.reviews ?? []).map((r) => r.text ?? "").filter(Boolean));
    for (const review of afterOwn.reviews ?? []) {
      if (!review.text) continue;
      if (knownTexts.has(review.text)) continue;
      knownTexts.add(review.text);
      const stars = review.rating ?? 0;
      push({
        tone: stars <= 2 ? "red" : stars === 3 ? "amber" : "green",
        kind: "own_listing",
        competitorName: afterOwn.name,
        sourceLabel: source,
        headline: `New ${stars ? `${stars}★ ` : ""}review on your listing`,
        detail: `“${review.text.slice(0, 140)}” · source: ${source}`,
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

// --- Instant-alert classification (Advise tier daily sweep) ---
//
// The diff engine reports everything that changed; the alert layer only
// interrupts the user for moves that matter today. Red = a threat to revenue
// now, amber = an opportunity or slow threat, and everything else (good
// news, small drift, structural price-list reshuffles) stays in Monday's
// weekly brief. Pure function — unit-testable.

export type AlertVerdict = "red" | "amber" | "weekly";

export type AlertClassification = {
  verdict: AlertVerdict;
  // Matches the email renderer's alert kinds where one exists; novel
  // classifications fall back to "general" at the send site.
  alertKind: "own_review" | "own_rating" | "price_cut" | "new_entrant" | "hours_change" | "competitor_rating" | "general";
};

// A competitor headline-price move under this threshold is churn, not news.
const ALERT_PRICE_PCT = 0.1;
// A competitor rating fall of this size (within a day) opens a poach window.
const ALERT_RATING_DROP = 0.5;

// Day-of-week tokens present in an opening-hours string. Comparing these
// sets is a cheap materiality test: reformatting "Mon-Fri 9-5" as
// "Mon–Fri 09:00–17:00" keeps the same days (weekly-only), while dropping
// or adding a day ("now open Sundays") is a real shift (alert).
export function weekdayTokens(hours: string): Set<string> {
  const tokens = hours.toLowerCase().match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*/g) ?? [];
  return new Set(tokens.map((token) => token.slice(0, 3)));
}

// Reads the "4.40 → 3.90" pair out of a change detail line.
function ratingDeltaFromDetail(detail: string): number | null {
  const match = /(\d(?:\.\d+)?)\s*→\s*(\d(?:\.\d+)?)/.exec(detail);
  if (!match) return null;
  const before = Number(match[1]);
  const after = Number(match[2]);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return after - before;
}

// Reads the "12 → 9" currency pair out of a price-change detail line.
function pricePctFromDetail(detail: string): number | null {
  const [before, after] = detail.split("→");
  if (!before || !after) return null;
  const oldPrice = parsePrice(before.trim());
  const newPrice = parsePrice(after.trim().split("·")[0]?.trim() ?? "");
  if (!oldPrice || !newPrice || oldPrice.currency !== newPrice.currency || oldPrice.amount === 0) return null;
  return (newPrice.amount - oldPrice.amount) / oldPrice.amount;
}

export function classifyAlert(change: DetectedChange): AlertClassification | null {
  switch (change.kind) {
    case "own_listing": {
      // Reputation fire on your own door: a scathing review or a rating
      // slide. Good news — 5★ reviews, rating recoveries, count growth —
      // waits for Monday by design (the user's call).
      const stars = /^(?:New )?(\d)?★? review on your listing$/i.exec(change.headline)?.[1];
      if (stars !== undefined && change.headline.toLowerCase().includes("review")) {
        return Number(stars) <= 2 ? { verdict: "red", alertKind: "own_review" } : null;
      }
      if (change.tone === "red" && change.headline.includes("rating")) {
        return { verdict: "red", alertKind: "own_rating" };
      }
      return null;
    }
    case "price": {
      // Only a parseable single-price move is classifiable: cuts ≥ 10%
      // interrupt (red — direct price pressure), raises ≥ 10% interrupt
      // (amber — a window to hold your price or capture switchers).
      if (!change.detail.includes("→")) return null;
      const pct = pricePctFromDetail(change.detail);
      if (pct === null) return null;
      if (pct <= -ALERT_PRICE_PCT) return { verdict: "red", alertKind: "price_cut" };
      if (pct >= ALERT_PRICE_PCT) return { verdict: "amber", alertKind: "general" };
      return null;
    }
    case "new_entry":
      return { verdict: "amber", alertKind: "new_entrant" };
    case "hours": {
      // The diff detail carries only the new hours ("Now: ..."), not the
      // previous string, so a day-set materiality test isn't possible from
      // the change alone. Hours edits are rare and the 7-day cooldown
      // suppresses repeats, so every hours change alerts as amber.
      return { verdict: "amber", alertKind: "hours_change" };
    }
    case "reviews": {
      // Competitor bleeding: a rating fall of ALERT_RATING_DROP or more
      // inside one scan gap is a poach window. Rises, small drifts, count
      // changes and new review quotes stay in the brief.
      if (!change.headline.includes("rating")) return null;
      const delta = ratingDeltaFromDetail(change.detail);
      if (delta === null || delta >= 0) return null;
      return delta <= -ALERT_RATING_DROP ? { verdict: "amber", alertKind: "competitor_rating" } : null;
    }
    default:
      return null;
  }
}

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
  own_listing: "Your business",
};

export function changesToBriefSignals(changes: DetectedChange[]): BriefSignal[] {
  return changes.slice(0, 3).map((change) => ({
    tone: change.tone,
    label: KIND_LABELS[change.kind],
    headline: change.headline,
    detail: change.detail,
  }));
}