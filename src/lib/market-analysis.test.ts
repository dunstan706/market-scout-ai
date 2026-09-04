import { describe, expect, it } from "vitest";
import type { Competitor, ResearchSnapshot } from "@/lib/change-detection";
import {
  analysisForPrompt,
  buildMarketAnalysis,
  computeBenchmarks,
  computeOwnStatus,
  computeTrends,
  formatMoney,
  formatOrdinal,
  type MarketAnalysis,
} from "@/lib/market-analysis";

function competitor(
  partial: Partial<Competitor> & { name: string; distanceMeters: number },
): Competitor {
  const { name, distanceMeters, ...rest } = partial;
  return {
    name,
    distanceMeters,
    priceSamples: [],
    sourceUrl: "https://example.com",
    sourceLabel: "Google Places",
    ...rest,
  };
}

function snapshot(
  competitors: Competitor[],
  capturedAt = "2026-09-01T08:00:00.000Z",
  ownListing?: ResearchSnapshot["ownListing"],
): ResearchSnapshot {
  return {
    location: { displayName: "Shoreditch, London", latitude: 51.52, longitude: -0.08 },
    competitors,
    ...(ownListing ? { ownListing } : {}),
    sources: [{ label: "Google Places", url: "https://maps.google.com/", kind: "reviews" }],
    warnings: [],
    capturedAt,
  };
}

const field = [
  competitor({
    name: "Glow Studio",
    distanceMeters: 400,
    priceSamples: ["$30"],
    priceLevel: "$",
    rating: 4.8,
    reviewCount: 90,
    openingHours: "Mo-Sa 09:00-19:00; Su 10:00-14:00",
  }),
  competitor({
    name: "Luxe Cuts",
    distanceMeters: 700,
    priceSamples: ["$45", "$60"],
    rating: 4.2,
    reviewCount: 200,
    openingHours: "Tu-Sa 10:00-18:00",
  }),
  competitor({
    name: "Velvet Spa",
    distanceMeters: 900,
    priceSamples: ["$50"],
    rating: 4.5,
    reviewCount: 130,
    openingHours: "Mo-Fr 09:00-17:00",
  }),
];

describe("format helpers", () => {
  it("renders money and ordinals", () => {
    expect(formatMoney(45, "USD")).toBe("$45");
    expect(formatMoney(9.5, "EUR")).toBe("€9.5");
    expect(formatMoney(1200, "INR")).toBe("₹1200");
    expect(formatOrdinal(1)).toBe("1st");
    expect(formatOrdinal(2)).toBe("2nd");
    expect(formatOrdinal(3)).toBe("3rd");
    expect(formatOrdinal(11)).toBe("11th");
    expect(formatOrdinal(21)).toBe("21st");
  });
});

describe("computeBenchmarks", () => {
  it("computes entry-price distribution, medians and Sunday coverage", () => {
    const b = computeBenchmarks(snapshot(field));
    expect(b.competitorCount).toBe(3);
    expect(b.nearestMeters).toBe(400);
    expect(b.priceCurrency).toBe("USD");
    expect(b.pricedCount).toBe(3);
    expect(b.entryPriceMin).toBe(30);
    expect(b.entryPriceMedian).toBe(45);
    expect(b.entryPriceMax).toBe(50);
    expect(b.reviewedCount).toBe(3);
    expect(b.ratingMedian).toBe(4.5);
    expect(b.priceLevelHistogram).toEqual({ $: 1 });
    expect(b.hoursPublishedCount).toBe(3);
    expect(b.sundayOpenCount).toBe(1); // only Glow Studio publishes Sunday hours
    expect(b.sundayUnknownCount).toBe(2);
  });

  it("guards missing pricing evidence", () => {
    const plain = competitor({ name: "Glow Studio", distanceMeters: 400 });
    const b = computeBenchmarks(snapshot([plain]));
    expect(b.pricedCount).toBe(0);
    expect(b.priceCurrency).toBeNull();
    expect(b.entryPriceMedian).toBeNull();
    expect(b.entryPriceMin).toBeNull();
    expect(b.ratingMedian).toBeNull();
    expect(b.reviewedCount).toBe(0);
  });

  it("never mixes currencies in the price distribution", () => {
    const mixed = [
      competitor({ name: "A", distanceMeters: 100, priceSamples: ["$40"] }),
      competitor({ name: "B", distanceMeters: 200, priceSamples: ["$80", "£45"] }),
    ];
    const b = computeBenchmarks(snapshot(mixed));
    expect(b.priceCurrency).toBe("USD");
    expect(b.entryPriceMedian).toBe(60); // 40 and 80 — the £45 sample is excluded
    expect(b.pricedCount).toBe(2);
  });

  it("handles an empty market", () => {
    const b = computeBenchmarks(snapshot([]));
    expect(b.competitorCount).toBe(0);
    expect(b.nearestMeters).toBeNull();
    expect(b.pricedCount).toBe(0);
  });
});

describe("computeOwnStatus", () => {
  const own = {
    name: "Radiance Salon",
    rating: 4.6,
    reviewCount: 44,
    url: "https://maps.google.com/?cid=1",
    reviews: [{ rating: 5, text: "Lovely." }],
  };

  it("ranks your rating against reviewed competitors", () => {
    const o = computeOwnStatus(snapshot(field, "2026-09-01T08:00:00.000Z", own), undefined);
    expect(o.found).toBe(true);
    expect(o.rating).toBe(4.6);
    expect(o.reviewedCount).toBe(3);
    expect(o.ratingRank).toBe(2); // only Glow Studio (4.8) ranks above
  });

  it("ranks your price among competitor entry prices", () => {
    const o = computeOwnStatus(snapshot(field, "2026-09-01T08:00:00.000Z", own), "$40");
    expect(o.ownPrice).toEqual({ amount: 40, currency: "USD" });
    expect(o.pricedCount).toBe(3);
    expect(o.ownPriceRank).toBe(2); // Glow Studio ($30) is cheaper
    expect(o.priceMedian).toBe(45);
  });

  it("accepts a bare number using the market currency", () => {
    const o = computeOwnStatus(snapshot(field, "2026-09-01T08:00:00.000Z", own), "40");
    expect(o.ownPrice).toEqual({ amount: 40, currency: "USD" });
  });

  it("reports found:false when the business has no Google listing", () => {
    const o = computeOwnStatus(snapshot(field), "$40");
    expect(o.found).toBe(false);
    expect(o.ratingRank).toBeNull();
    expect(o.ownPriceRank).toBeNull();
  });

  it("never ranks without a reviewed field", () => {
    const only = competitor({ name: "Solo", distanceMeters: 100, rating: 4.4 });
    const o = computeOwnStatus(snapshot([only], "2026-09-01T08:00:00.000Z", own), undefined);
    expect(o.reviewedCount).toBe(1);
    expect(o.ratingRank).toBe(1);
  });
});

describe("computeTrends", () => {
  it("measures price direction, rating drift, review velocity and new entrants across two scans", () => {
    const first = snapshot(
      [competitor({ name: "Glow Studio", distanceMeters: 400, priceSamples: ["$45"], rating: 4.5, reviewCount: 100 })],
      "2026-09-01T08:00:00.000Z",
    );
    const second = snapshot(
      [
        competitor({ name: "Glow Studio", distanceMeters: 400, priceSamples: ["$40"], rating: 4.7, reviewCount: 114 }),
        competitor({ name: "Luxe Cuts", distanceMeters: 900, priceSamples: ["$55"] }),
      ],
      "2026-09-15T08:00:00.000Z",
    );
    const t = computeTrends([first, second]);
    expect(t.sufficient).toBe(true);
    expect(t.snapshotCount).toBe(2);
    expect(t.spanDays).toBe(14);
    expect(t.comparable).toBe(1);
    expect(t.priceTracked).toBe(1);
    expect(t.priceFell).toBe(1);
    expect(t.priceRose).toBe(0);
    expect(t.ratingRoseCount).toBe(1);
    expect(t.ratingFellCount).toBe(0);
    expect(t.ratingMoversTop).toEqual([{ name: "Glow Studio", from: 4.5, to: 4.7 }]);
    expect(t.avgReviewVelocityPerWeek).toBeCloseTo(7, 1); // 14 reviews / 2 weeks
    expect(t.newEntrants).toEqual(["Luxe Cuts"]);
  });

  it("reports insufficient evidence with fewer than two snapshots", () => {
    const t = computeTrends([snapshot(field)]);
    expect(t.sufficient).toBe(false);
    expect(t.newEntrants).toEqual([]);
    expect(t.avgReviewVelocityPerWeek).toBeNull();
  });

  it("orders snapshots chronologically regardless of input order", () => {
    const later = snapshot([], "2026-09-15T08:00:00.000Z");
    const earlier = snapshot([], "2026-09-01T08:00:00.000Z");
    const t = computeTrends([later, earlier]);
    expect(t.sufficient).toBe(true);
    expect(t.spanDays).toBe(14);
  });
});

describe("buildMarketAnalysis / analysisForPrompt", () => {
  it("assembles benchmarks, own status and trends for the prompt", () => {
    const current = snapshot(
      field,
      "2026-09-15T08:00:00.000Z",
      { name: "Radiance Salon", rating: 4.6, reviewCount: 44 },
    );
    const history = [snapshot(field, "2026-09-01T08:00:00.000Z")];
    const a: MarketAnalysis = buildMarketAnalysis(current, history, "$40");
    expect(a.benchmarks.entryPriceMedian).toBe(45);
    expect(a.own.found).toBe(true);
    expect(a.own.ratingRank).toBe(2);
    expect(a.own.ownPriceRank).toBe(2);
    const text = analysisForPrompt(a);
    expect(text).toContain("median $45");
    expect(text).toContain("2nd of 3 reviewed nearby");
    expect(text).toContain("2nd cheapest of 3");
  });

  it("renders nothing usable when evidence is absent", () => {
    const a: MarketAnalysis = buildMarketAnalysis(snapshot([]), []);
    expect(analysisForPrompt(a)).toBe("");
  });
});
