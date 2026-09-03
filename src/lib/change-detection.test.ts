import { describe, expect, it } from "vitest";
import {
  changesToBriefSignals,
  detectChanges,
  parseDetectedChanges,
  parsePrice,
  parseResearchSnapshot,
  type Competitor,
  type ResearchSnapshot,
} from "@/lib/change-detection";

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

function snapshot(competitors: Competitor[], capturedAt = "2026-09-01T08:00:00.000Z"): ResearchSnapshot {
  return {
    location: { displayName: "Shoreditch, London", latitude: 51.52, longitude: -0.08 },
    competitors,
    sources: [{ label: "Google Places", url: "https://maps.google.com/", kind: "reviews" }],
    warnings: [],
    capturedAt,
  };
}

// A stable fixture business that appears in both snapshots.
function glow(overrides: Partial<Competitor> = {}): Competitor {
  return competitor({
    name: "Glow Studio",
    distanceMeters: 400,
    latitude: 51.5,
    longitude: -0.1,
    priceSamples: ["£45"],
    priceLevel: "$$",
    rating: 4.5,
    reviewCount: 120,
    reviewQuote: "Fast and friendly.",
    openingHours: "Mon–Sat 9am–7pm",
    ...overrides,
  });
}

describe("parsePrice", () => {
  it("parses symbol-prefixed prices", () => {
    expect(parsePrice("£45")).toEqual({ amount: 45, currency: "GBP" });
    expect(parsePrice("$120")).toEqual({ amount: 120, currency: "USD" });
    expect(parsePrice("€9,50")).toEqual({ amount: 9.5, currency: "EUR" });
  });

  it("parses currency codes", () => {
    expect(parsePrice("INR 1,200")).toEqual({ amount: 1200, currency: "INR" });
    expect(parsePrice("USD 30")).toEqual({ amount: 30, currency: "USD" });
  });

  it("rejects non-price strings", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("from £45 upwards")).toBeNull();
    expect(parsePrice("£45–£60")).toBeNull();
  });
});

describe("detectChanges", () => {
  it("reports nothing on the baseline run", () => {
    const changes = detectChanges(null, snapshot([glow()]));
    expect(changes).toEqual([]);
  });

  it("detects a headline price cut as a red signal with old → new values", () => {
    const changes = detectChanges(snapshot([glow()]), snapshot([glow({ priceSamples: ["£40"] })]));
    expect(changes).toHaveLength(1);
    expect(changes[0]?.tone).toBe("red");
    expect(changes[0]?.kind).toBe("price");
    expect(changes[0]?.headline).toBe("Glow Studio cut its headline price to £40");
    expect(changes[0]?.detail).toContain("£45 → £40");
  });

  it("marks a headline price rise as green (an opportunity)", () => {
    const changes = detectChanges(snapshot([glow()]), snapshot([glow({ priceSamples: ["£48"] })]));
    expect(changes[0]?.tone).toBe("green");
    expect(changes[0]?.headline).toBe("Glow Studio raised its headline price to £48");
  });

  it("does not compare prices across currencies", () => {
    const changes = detectChanges(snapshot([glow()]), snapshot([glow({ priceSamples: ["$45"] })]));
    // £45 → $45 is a list change, not a numeric same-currency comparison.
    expect(changes[0]?.tone).toBe("amber");
    expect(changes[0]?.headline).toBe("Glow Studio updated its published prices");
  });

  it("detects a multi-item price list change generically", () => {
    const before = snapshot([glow()]);
    const after = snapshot([glow({ priceSamples: ["£45", "£60"] })]);
    const changes = detectChanges(before, after);
    expect(changes[0]?.headline).toBe("Glow Studio updated its published prices");
    expect(changes[0]?.detail).toContain("1 item → 2 items");
  });

  it("detects a price level change", () => {
    const changes = detectChanges(snapshot([glow()]), snapshot([glow({ priceLevel: "$$$", priceSamples: ["£45"] })]));
    expect(changes[0]?.headline).toBe("Glow Studio changed its price level");
    expect(changes[0]?.detail).toContain("$$ → $$$");
  });

  it("detects rating moves", () => {
    const changes = detectChanges(snapshot([glow()]), snapshot([glow({ rating: 4.7 })]));
    expect(changes[0]?.kind).toBe("reviews");
    expect(changes[0]?.headline).toBe("Glow Studio's rating rose to 4.7/5");
  });

  it("detects review count growth", () => {
    const changes = detectChanges(snapshot([glow()]), snapshot([glow({ reviewCount: 157 })]));
    const countChange = changes.find((c) => c.headline.includes("157 ratings"));
    expect(countChange?.detail).toContain("+37 since the last scan");
  });

  it("detects hours changes", () => {
    const changes = detectChanges(
      snapshot([glow()]),
      snapshot([glow({ openingHours: "Mon–Sat 9am–6pm" })]),
    );
    expect(changes[0]?.kind).toBe("hours");
    expect(changes[0]?.detail).toContain("Now: Mon–Sat 9am–6pm");
  });

  it("flags businesses that first appear after the baseline", () => {
    const changes = detectChanges(
      snapshot([glow()]),
      snapshot([glow(), competitor({ name: "Luxe Cuts", distanceMeters: 900 })]),
    );
    const entry = changes.find((c) => c.kind === "new_entry");
    expect(entry?.competitorName).toBe("Luxe Cuts");
    expect(entry?.headline).toBe("Luxe Cuts first appeared in our scans");
    expect(entry?.detail).toContain("900 m from you");
    expect(entry?.tone).toBe("amber");
  });

  it("does not claim openings when scans are identical", () => {
    const changes = detectChanges(snapshot([glow()]), snapshot([glow()]));
    expect(changes).toEqual([]);
  });

  it("orders red threats first and caps the total", () => {
    const manyNew = Array.from({ length: 6 }, (_, i) =>
      competitor({ name: `New Place ${i}`, distanceMeters: 500 + i * 50 }),
    );
    const changes = detectChanges(
      snapshot([glow({ priceSamples: ["£45"] })]),
      snapshot([glow({ priceSamples: ["£39"] }), ...manyNew]),
    );
    expect(changes.length).toBeLessThanOrEqual(8);
    expect(changes[0]?.tone).toBe("red");
    const entries = changes.filter((c) => c.kind === "new_entry");
    expect(entries.length).toBeLessThanOrEqual(3);
  });

  it("matches the same business when coordinates are missing via distance delta", () => {
    const before = snapshot([competitor({ name: "Glow Studio", distanceMeters: 500, priceSamples: ["£45"] })]);
    const after = snapshot([competitor({ name: "Glow Studio", distanceMeters: 620, priceSamples: ["£45"] })]);
    // Same prices → no change, but crucially no bogus new_entry either.
    expect(detectChanges(before, after)).toEqual([]);
  });
});

describe("parseResearchSnapshot / parseDetectedChanges (JSONB round-trip)", () => {
  it("parses a stored snapshot", () => {
    const stored = snapshot([glow()]);
    const parsed = parseResearchSnapshot(JSON.parse(JSON.stringify(stored)));
    expect(parsed?.competitors[0]?.name).toBe("Glow Studio");
    expect(parsed?.capturedAt).toBe(stored.capturedAt);
  });

  it("returns null for malformed snapshots", () => {
    expect(parseResearchSnapshot({ nope: true })).toBeNull();
    expect(parseResearchSnapshot(null)).toBeNull();
  });

  it("parses stored detected changes and drops malformed items", () => {
    const parsed = parseDetectedChanges([
      { tone: "red", kind: "price", headline: "H", detail: "D" },
      { tone: "purple", kind: "price", headline: "bad", detail: "bad" },
      "nonsense",
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.headline).toBe("H");
  });
});

describe("changesToBriefSignals", () => {
  it("maps detected changes to brief signals, capped at three", () => {
    const changes = detectChanges(
      snapshot([glow()]),
      snapshot([glow({ priceSamples: ["£40"] }), competitor({ name: "Luxe Cuts", distanceMeters: 900 })]),
    );
    const signals = changesToBriefSignals(changes);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.length).toBeLessThanOrEqual(3);
    const price = signals.find((s) => s.label === "Price move");
    expect(price?.tone).toBe("red");
    const entry = signals.find((s) => s.label === "New in area");
    expect(entry?.tone).toBe("amber");
  });
});