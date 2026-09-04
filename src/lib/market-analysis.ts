import { parsePrice, sameBusiness, type Competitor, type ResearchSnapshot } from "@/lib/change-detection";

// Pure, client-safe module: turns research snapshots into honest market
// intelligence — neighbourhood benchmarks, your position in the field, and
// multi-scan trends. No network, no server APIs — fully unit-testable.
//
// Honesty rules baked in: every figure carries its denominator ("median among
// 6 competitors that publish prices"), stats only compute when there is enough
// evidence, and nothing is ever inferred beyond what the snapshots contain.

export type OwnReview = { rating?: number | undefined; text?: string | undefined; author?: string | undefined };

export type MarketBenchmarks = {
  competitorCount: number;
  nearestMeters: number | null;
  // Entry (cheapest published) price point per competitor — same-currency only.
  priceCurrency: string | null;
  pricedCount: number;
  entryPriceMin: number | null;
  entryPriceMedian: number | null;
  entryPriceMax: number | null;
  priceLevelHistogram: Record<string, number>;
  reviewedCount: number;
  ratingMedian: number | null;
  hoursPublishedCount: number;
  sundayOpenCount: number;
  sundayClosedCount: number;
  sundayUnknownCount: number;
};

export type OwnStatus = {
  found: boolean;
  name?: string | undefined;
  rating?: number | undefined;
  reviewCount?: number | undefined;
  url?: string | undefined;
  reviews: OwnReview[];
  // Position against reviewed competitors (higher rating = better rank).
  reviewedCount: number;
  ratingRank: number | null;
  // Position of your own price against competitor entry prices.
  ownPrice: { amount: number; currency: string } | null;
  pricedCount: number;
  ownPriceRank: number | null;
  priceMedian: number | null;
};

export type RatingMover = { name: string; from: number; to: number };

export type TrendSummary = {
  sufficient: boolean;
  snapshotCount: number;
  spanDays: number | null;
  comparable: number;
  // Entry-price direction among competitors present in both ends.
  priceFell: number;
  priceRose: number;
  priceSame: number;
  priceTracked: number;
  // Rating drift (|Δ| ≥ 0.05) among competitors present in both ends.
  ratingFellCount: number;
  ratingRoseCount: number;
  ratingMoversTop: RatingMover[];
  // Mean per-competitor review-count growth, per week.
  avgReviewVelocityPerWeek: number | null;
  // Businesses in the newest snapshot not present in the oldest.
  newEntrants: string[];
};

export type MarketAnalysis = {
  at: string;
  benchmarks: MarketBenchmarks;
  own: OwnStatus;
  trends: TrendSummary;
};

const CURRENCY_PREFERENCE = ["USD", "GBP", "EUR", "INR"];

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  INR: "₹",
};

export function formatMoney(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const digits = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${symbol}${digits}`;
}

export function formatOrdinal(value: number): string {
  const mod100 = Math.abs(value) % 100;
  const mod10 = mod100 % 10;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}

// --- Shared money helpers (same-currency rules as change-detection) ---

function dominantCurrency(competitors: Competitor[]): string | null {
  const counts = new Map<string, number>();
  for (const competitor of competitors) {
    for (const sample of competitor.priceSamples) {
      const parsed = parsePrice(sample);
      if (parsed) counts.set(parsed.currency, (counts.get(parsed.currency) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const currency of CURRENCY_PREFERENCE) {
    const count = counts.get(currency) ?? 0;
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best;
}

// Cheapest published price point of one competitor in the given currency.
function entryPriceAmount(competitor: Competitor, currency: string): number | null {
  let min: number | null = null;
  for (const sample of competitor.priceSamples) {
    const parsed = parsePrice(sample);
    if (!parsed || parsed.currency !== currency) continue;
    if (min === null || parsed.amount < min) min = parsed.amount;
  }
  return min;
}

function entryPricePoints(competitors: Competitor[]): { name: string; amount: number; currency: string }[] {
  const currency = dominantCurrency(competitors);
  if (!currency) return [];
  const points: { name: string; amount: number; currency: string }[] = [];
  for (const competitor of competitors) {
    const amount = entryPriceAmount(competitor, currency);
    if (amount !== null) points.push({ name: competitor.name, amount, currency });
  }
  return points;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function sundayClassification(hours: string): "open" | "closed" | "unknown" {
  const value = hours.toLocaleLowerCase();
  // Google lists "Sunday: …"; OpenStreetMap abbreviates to "Su …" / "Mo-Su …".
  if (!value.includes("sun") && !/\bsu\b/.test(value)) return "unknown";
  const closed =
    /sundays?\s*[:=-]?\s*(closed|off|-{2})/.test(value) || /\bsu\s*(closed|off|-{2})\b/.test(value);
  const open = /sundays?\s*[:=-]?\s*\d/.test(value) || /\bsu\s*(?:–|-|:)?\s*\d/.test(value);
  if (open && !closed) return "open";
  if (closed) return "closed";
  return "unknown";
}

function parseOwnPrice(text: string | null | undefined, marketCurrency: string | null): { amount: number; currency: string } | null {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const parsed = parsePrice(trimmed);
  if (parsed) return parsed;
  // Bare digits ("45" or "45.00") — assume the market's currency.
  const bare = /^\d{1,4}(?:\.\d{1,2})?$/.exec(trimmed);
  if (bare && marketCurrency) return { amount: Number(bare[0]), currency: marketCurrency };
  return null;
}

// --- Benchmarks ---

export function computeBenchmarks(snapshot: ResearchSnapshot): MarketBenchmarks {
  const competitors = snapshot.competitors;
  const pricePoints = entryPricePoints(competitors);
  const priceLevels = new Map<string, number>();
  for (const competitor of competitors) {
    if (!competitor.priceLevel) continue;
    priceLevels.set(competitor.priceLevel, (priceLevels.get(competitor.priceLevel) ?? 0) + 1);
  }
  const ratingValues = competitors
    .map((competitor) => competitor.rating)
    .filter((rating): rating is number => rating !== undefined);
  const hours = competitors.map((competitor) => competitor.openingHours).filter((value): value is string => !!value);
  let sundayOpen = 0;
  let sundayClosed = 0;
  for (const hoursText of hours) {
    const kind = sundayClassification(hoursText);
    if (kind === "open") sundayOpen += 1;
    else if (kind === "closed") sundayClosed += 1;
  }
  const entryAmounts = pricePoints.map((point) => point.amount);
  return {
    competitorCount: competitors.length,
    nearestMeters:
      competitors.length > 0 ? Math.min(...competitors.map((competitor) => competitor.distanceMeters)) : null,
    priceCurrency: pricePoints.length > 0 ? pricePoints[0]!.currency : dominantCurrency(competitors),
    pricedCount: pricePoints.length,
    entryPriceMin: entryAmounts.length > 0 ? Math.min(...entryAmounts) : null,
    entryPriceMedian: median(entryAmounts),
    entryPriceMax: entryAmounts.length > 0 ? Math.max(...entryAmounts) : null,
    priceLevelHistogram: Object.fromEntries(priceLevels),
    reviewedCount: ratingValues.length,
    ratingMedian: median(ratingValues),
    hoursPublishedCount: hours.length,
    sundayOpenCount: sundayOpen,
    sundayClosedCount: sundayClosed,
    sundayUnknownCount: hours.length - sundayOpen - sundayClosed,
  };
}

// --- Your position ---

export function computeOwnStatus(
  snapshot: ResearchSnapshot,
  ownPriceText?: string | null,
): OwnStatus {
  const benchmarks = computeBenchmarks(snapshot);
  const own = snapshot.ownListing;
  if (!own) {
    return {
      found: false,
      reviews: [],
      reviewedCount: benchmarks.reviewedCount,
      ratingRank: null,
      ownPrice: null,
      pricedCount: benchmarks.pricedCount,
      ownPriceRank: null,
      priceMedian: benchmarks.entryPriceMedian,
    };
  }
  let ratingRank: number | null = null;
  if (own.rating !== undefined) {
    const above = snapshot.competitors.filter(
      (competitor) => competitor.rating !== undefined && competitor.rating > own.rating!,
    ).length;
    ratingRank = benchmarks.reviewedCount > 0 ? above + 1 : null;
  }
  const pricePoints = entryPricePoints(snapshot.competitors);
  const ownPrice = parseOwnPrice(ownPriceText, pricePoints[0]?.currency ?? benchmarks.priceCurrency);
  let ownPriceRank: number | null = null;
  if (ownPrice && pricePoints.length > 0 && pricePoints[0]!.currency === ownPrice.currency) {
    const cheaper = pricePoints.filter((point) => point.amount < ownPrice!.amount).length;
    ownPriceRank = cheaper + 1;
  }
  return {
    found: true,
    name: own.name,
    rating: own.rating,
    reviewCount: own.reviewCount,
    url: own.url,
    reviews: own.reviews ?? [],
    reviewedCount: benchmarks.reviewedCount,
    ratingRank,
    ownPrice,
    pricedCount: pricePoints.length,
    ownPriceRank,
    priceMedian: pricePoints.length > 0 ? median(pricePoints.map((point) => point.amount)) : null,
  };
}

// --- Trends across stored snapshots ---

export function computeTrends(snapshots: ResearchSnapshot[]): TrendSummary {
  const sorted = [...snapshots]
    .filter((snapshot) => snapshot && snapshot.capturedAt)
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  const empty: TrendSummary = {
    sufficient: false,
    snapshotCount: sorted.length,
    spanDays: null,
    comparable: 0,
    priceFell: 0,
    priceRose: 0,
    priceSame: 0,
    priceTracked: 0,
    ratingFellCount: 0,
    ratingRoseCount: 0,
    ratingMoversTop: [],
    avgReviewVelocityPerWeek: null,
    newEntrants: [],
  };
  if (sorted.length < 2) return empty;

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const spanMs = new Date(last.capturedAt).getTime() - new Date(first.capturedAt).getTime();
  const spanDays = spanMs > 0 ? Math.max(0, Math.round((spanMs / 86_400_000) * 10) / 10) : null;

  // Same currency across the whole window so direction compares are valid.
  const allCompetitors = sorted.flatMap((snapshot) => snapshot.competitors);
  const currency = dominantCurrency(allCompetitors);

  const firstEntry = new Map<string, number>();
  for (const competitor of first.competitors) {
    if (!currency) break;
    const amount = entryPriceAmount(competitor, currency);
    if (amount !== null) firstEntry.set(competitor.name, amount);
  }

  let comparable = 0;
  let priceFell = 0;
  let priceRose = 0;
  let priceSame = 0;
  let priceTracked = 0;
  let ratingFellCount = 0;
  let ratingRoseCount = 0;
  const ratingMoversTop: RatingMover[] = [];
  let reviewDeltasPerWeek: number[] = [];
  const newEntrants: string[] = [];

  for (const current of last.competitors) {
    const prior = first.competitors.find((candidate) => sameBusiness(candidate, current));
    if (!prior) {
      newEntrants.push(current.name);
      continue;
    }
    comparable += 1;
    if (currency) {
      const fromAmount = firstEntry.get(prior.name);
      const toAmount = entryPriceAmount(current, currency);
      if (fromAmount !== undefined && toAmount !== null) {
        priceTracked += 1;
        if (toAmount < fromAmount) priceFell += 1;
        else if (toAmount > fromAmount) priceRose += 1;
        else priceSame += 1;
      }
    }
    if (prior.rating !== undefined && current.rating !== undefined) {
      const delta = current.rating - prior.rating;
      if (Math.abs(delta) >= 0.05) {
        if (delta > 0) ratingRoseCount += 1;
        else ratingFellCount += 1;
        ratingMoversTop.push({ name: current.name, from: prior.rating, to: current.rating });
      }
    }
    if (prior.reviewCount !== undefined && current.reviewCount !== undefined && spanMs > 0) {
      const weeks = spanMs / (7 * 86_400_000);
      if (weeks > 0) reviewDeltasPerWeek.push((current.reviewCount - prior.reviewCount) / weeks);
    }
  }
  ratingMoversTop.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));

  return {
    sufficient: true,
    snapshotCount: sorted.length,
    spanDays,
    comparable,
    priceFell,
    priceRose,
    priceSame,
    priceTracked,
    ratingFellCount,
    ratingRoseCount,
    ratingMoversTop: ratingMoversTop.slice(0, 3),
    avgReviewVelocityPerWeek:
      reviewDeltasPerWeek.length > 0
        ? reviewDeltasPerWeek.reduce((sum, value) => sum + value, 0) / reviewDeltasPerWeek.length
        : null,
    newEntrants: newEntrants.slice(0, 5),
  };
}

export function buildMarketAnalysis(
  current: ResearchSnapshot,
  historyAsc: ResearchSnapshot[],
  ownPriceText?: string | null,
): MarketAnalysis {
  const window = historyAsc.length > 0 ? [...historyAsc, current] : [current];
  return {
    at: current.capturedAt,
    benchmarks: computeBenchmarks(current),
    own: computeOwnStatus(current, ownPriceText),
    trends: computeTrends(window),
  };
}

// --- Compact prompt / display rendering ---

function ratingText(rating: number | undefined): string | null {
  return rating === undefined ? null : `${rating.toFixed(1)}/5`;
}

export function analysisForPrompt(analysis: MarketAnalysis): string {
  const lines: string[] = [];
  const b = analysis.benchmarks;
  if (b.competitorCount > 0) {
    const near = b.nearestMeters !== null ? (b.nearestMeters < 1000 ? `${b.nearestMeters} m` : `${(b.nearestMeters / 1000).toFixed(1)} km`) : "unknown distance";
    lines.push(`- ${b.competitorCount} nearby ${b.competitorCount === 1 ? "business" : "businesses"} tracked; nearest ${near}`);
  }
  if (b.priceCurrency && b.pricedCount > 0 && b.entryPriceMedian !== null && b.entryPriceMin !== null && b.entryPriceMax !== null) {
    lines.push(
      `- Local entry prices: median ${formatMoney(b.entryPriceMedian, b.priceCurrency)} (range ${formatMoney(b.entryPriceMin, b.priceCurrency)}–${formatMoney(b.entryPriceMax, b.priceCurrency)}) across ${b.pricedCount} that publish prices`,
    );
  }
  const o = analysis.own;
  if (o.found) {
    const rating = ratingText(o.rating);
    const rank =
      o.ratingRank !== null && o.reviewedCount > 0
        ? ` · ${formatOrdinal(o.ratingRank)} of ${o.reviewedCount} reviewed nearby`
        : "";
    if (rating) lines.push(`- Your listing: rating ${rating}${rank}`);
    if (o.ownPrice && o.ownPriceRank !== null && o.pricedCount > 0) {
      const medianText = o.priceMedian !== null ? ` (median ${formatMoney(o.priceMedian, o.ownPrice.currency)})` : "";
      lines.push(
        `- Your price position: ${formatOrdinal(o.ownPriceRank)} cheapest of ${o.pricedCount} publishing prices at ${formatMoney(o.ownPrice.amount, o.ownPrice.currency)}${medianText}`,
      );
    } else if (o.found && !o.ownPrice && o.pricedCount > 0) {
      lines.push(`- Your own price is not set, so no price position is shown (median is ${o.priceMedian !== null && b.priceCurrency ? formatMoney(o.priceMedian, b.priceCurrency) : "unknown"})`);
    }
  } else if (b.reviewedCount > 0 || b.pricedCount > 0) {
    lines.push("- Your own Google listing was not found, so your position in the market is not reported");
  }
  const t = analysis.trends;
  if (t.sufficient && t.spanDays !== null) {
    const span =
      t.spanDays >= 30 ? `${Math.round(t.spanDays / 30)} month${Math.round(t.spanDays / 30) === 1 ? "" : "s"}` : `${Math.round(t.spanDays)} day${Math.round(t.spanDays) === 1 ? "" : "s"}`;
    if (t.priceTracked > 0) {
      lines.push(
        `- Trend over ${span} (${t.snapshotCount} scans): ${t.priceFell} cut entry prices, ${t.priceRose} raised them, ${t.priceSame} unchanged`,
      );
    }
    if (t.avgReviewVelocityPerWeek !== null) {
      lines.push(
        `- Review momentum: ${t.avgReviewVelocityPerWeek >= 0 ? "+" : ""}${t.avgReviewVelocityPerWeek.toFixed(1)} ratings per business per week`,
      );
    }
    if (t.ratingMoversTop.length > 0) {
      lines.push(
        `- Rating movers: ${t.ratingMoversTop.map((mover) => `${mover.name} ${mover.from.toFixed(1)}→${mover.to.toFixed(1)}`).join(", ")}`,
      );
    }
    if (t.newEntrants.length > 0) {
      lines.push(`- New in the area over the window: ${t.newEntrants.join(", ")}`);
    }
  }
  if (lines.length === 0) return "";
  return `Market context (computed from your stored scans — treat as evidence):\n${lines.join("\n")}`;
}
