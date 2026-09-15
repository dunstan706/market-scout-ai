import { describe, expect, it } from "vitest";
import {
  competitorDraftFromScan,
  factsFromScanCompetitor,
  mergeFact,
  normalizeName,
  priceLevelToPhrase,
  scanNameForWorkspace,
  type ExistingFactLike,
  type ScanFactDraft,
} from "./workspace-sync.server";

const SCAN_FACT: ScanFactDraft = {
  field: "rating",
  value: "4.6 (120 reviews)",
  source_url: "https://maps.example/listing",
  source_label: "Google Maps",
  effective_date: "2026-09-15",
};

function existing(overrides: Partial<ExistingFactLike>): ExistingFactLike {
  return { status: "reported", origin: "scan", value: "4.5 (100 reviews)", ...overrides };
}

describe("scanNameForWorkspace", () => {
  it("cleans whitespace and keeps short names", () => {
    expect(scanNameForWorkspace("  Studio   Lime ")).toBe("Studio Lime");
  });

  it("truncates long names at a word boundary", () => {
    const name = "A".repeat(80) + " Beauty Emporium and Nail Lounge Extraordinaire";
    const result = scanNameForWorkspace(name);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith(" ")).toBe(false);
  });
});

describe("normalizeName", () => {
  it("ignores case, punctuation, and generic business words", () => {
    expect(normalizeName("Studio Lime")).toBe(normalizeName("the Studio Lime!"));
  });

  it("never returns empty for non-empty input", () => {
    expect(normalizeName("The Spa").length).toBeGreaterThan(0);
  });
});

describe("priceLevelToPhrase", () => {
  it("maps 0-4 to phrases", () => {
    expect(priceLevelToPhrase("0")).toBe("budget");
    expect(priceLevelToPhrase("2")).toBe("moderate");
    expect(priceLevelToPhrase("4")).toBe("premium");
  });

  it("returns null for missing or invalid levels", () => {
    expect(priceLevelToPhrase(undefined)).toBeNull();
    expect(priceLevelToPhrase(null)).toBeNull();
    expect(priceLevelToPhrase("cheap")).toBeNull();
  });
});

describe("factsFromScanCompetitor", () => {
  const base = {
    priceSamples: [],
    sourceUrl: "https://maps.example/listing",
    sourceLabel: "Google Maps",
  };

  it("attaches the scan source to every fact", () => {
    const facts = factsFromScanCompetitor(
      { ...base, rating: 4.6, reviewCount: 120 },
      "2026-09-15T08:00:00Z",
    );
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.source_url).toBe("https://maps.example/listing");
      expect(fact.source_label).toBe("Google Maps");
      expect(fact.effective_date).toBe("2026-09-15");
    }
  });

  it("formats rating with review count", () => {
    const facts = factsFromScanCompetitor({ ...base, rating: 4.6, reviewCount: 120 }, "2026-09-15T08:00:00Z");
    const rating = facts.find((f) => f.field === "rating");
    expect(rating?.value).toBe("4.6 (120 reviews)");
  });

  it("falls back from price level to price samples", () => {
    const withLevel = factsFromScanCompetitor({ ...base, priceLevel: "3" }, "2026-09-15T08:00:00Z");
    expect(withLevel.find((f) => f.field === "price_signal")?.value).toBe("premium");

    const withSamples = factsFromScanCompetitor(
      { ...base, priceSamples: ["Cut 350 kr", "Color 900 kr"] },
      "2026-09-15T08:00:00Z",
    );
    expect(withSamples.find((f) => f.field === "price_signal")?.value).toContain("Cut 350 kr");
  });

  it("records an announced opening date", () => {
    const facts = factsFromScanCompetitor({ ...base, openingDate: "October 2026" }, "2026-09-15T08:00:00Z");
    const openings = facts.find((f) => f.field === "openings");
    expect(openings?.value).toContain("October 2026");
  });

  it("produces no facts from an empty competitor", () => {
    expect(factsFromScanCompetitor({ ...base }, "2026-09-15T08:00:00Z")).toEqual([]);
  });
});

describe("mergeFact — the manual-wins policy", () => {
  it("creates when there is no existing fact", () => {
    expect(mergeFact(null, SCAN_FACT)).toBe("create");
  });

  it("creates when the field is explicitly unknown", () => {
    expect(mergeFact(existing({ status: "unknown", value: null }), SCAN_FACT)).toBe("create");
  });

  it("never touches a manually entered fact", () => {
    expect(
      mergeFact(existing({ origin: "manual", value: "totally different" }), SCAN_FACT),
    ).toBe("skip");
  });

  it("respects a confirmed 'not published' answer", () => {
    expect(mergeFact(existing({ status: "unavailable", value: null }), SCAN_FACT)).toBe("skip");
  });

  it("skips when the scanned value is unchanged", () => {
    expect(
      mergeFact(existing({ value: "4.6 (120 reviews)" }), SCAN_FACT),
    ).toBe("skip");
  });

  it("flags a scan-sourced value change instead of silently overwriting", () => {
    expect(
      mergeFact(existing({ value: "4.2 (90 reviews)" }), SCAN_FACT),
    ).toBe("flag");
  });
});

describe("competitorDraftFromScan", () => {
  it("derives area from the second-to-last address segment", () => {
    const draft = competitorDraftFromScan(
      {
        name: "Studio Lime",
        address: "Lime Street 4, Old Town, Stockholm, Sweden",
        website: "https://studiolime.example",
        priceSamples: [],
        sourceUrl: "https://maps.example",
        sourceLabel: "Google Maps",
      },
      "2026-09-15T08:00:00Z",
    );
    expect(draft.name).toBe("Studio Lime");
    expect(draft.area).toBe("Stockholm");
    expect(draft.website_url).toBe("https://studiolime.example");
  });
});
