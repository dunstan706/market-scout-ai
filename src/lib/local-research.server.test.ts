import { describe, expect, it } from "vitest";
import {
  buildEvidenceBrief,
  formatDistance,
  isSameCompetitor,
  mergeCompetitors,
  namesLikelyMatch,
  normalizeName,
  readJsonLdEvidence,
  type ResearchCompetitor,
  type ResearchSnapshot,
} from "@/lib/local-research.server";

function competitor(
  partial: Partial<ResearchCompetitor> & { name: string; distanceMeters: number },
): ResearchCompetitor {
  return {
    name: partial.name,
    distanceMeters: partial.distanceMeters,
    priceSamples: [],
    sourceUrl: "https://example.com",
    sourceLabel: "Test",
    ...partial,
  };
}

function snapshot(competitors: ResearchCompetitor[]): ResearchSnapshot {
  return {
    location: { displayName: "Shoreditch, London, Greater London, England", latitude: 51.52, longitude: -0.08 },
    competitors,
    sources: [{ label: "OpenStreetMap", url: "https://www.openstreetmap.org/", kind: "directory" }],
    warnings: [],
    capturedAt: new Date().toISOString(),
  };
}

describe("formatDistance", () => {
  it("shows metres under 1 km", () => {
    expect(formatDistance(500)).toBe("500 m");
    expect(formatDistance(999)).toBe("999 m");
  });

  it("shows kilometres with one decimal at 1 km and above", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(1500)).toBe("1.5 km");
    expect(formatDistance(12345)).toBe("12.3 km");
  });
});

describe("normalizeName", () => {
  it("lowercases and collapses punctuation and ampersands", () => {
    expect(normalizeName("Glow & Co.  Salon")).toBe("glow and co");
  });

  it("strips common legal/type suffixes", () => {
    expect(normalizeName("The Luxe Hair Studio Ltd")).toBe("luxe hair studio");
  });

  it("returns an empty string for nothing but filler words", () => {
    expect(normalizeName("The Salon")).toBe("");
  });
});

describe("namesLikelyMatch", () => {
  it("matches exact names after normalization", () => {
    expect(namesLikelyMatch("Glow Studio", "Glow Studio")).toBe(true);
    expect(namesLikelyMatch("Glow Studio Salon", "Glow Studio")).toBe(true);
  });

  it("rejects genuinely different names", () => {
    expect(namesLikelyMatch("Glow Studio", "Luxe Cuts")).toBe(false);
  });

  it("rejects empty names", () => {
    expect(namesLikelyMatch("", "Glow Studio")).toBe(false);
  });
});

describe("isSameCompetitor", () => {
  it("treats same-named places within 150 m as one business", () => {
    const a = competitor({ name: "Glow Studio", distanceMeters: 500, latitude: 51.5, longitude: -0.1 });
    const b = competitor({ name: "Glow Studio", distanceMeters: 520, latitude: 51.5008, longitude: -0.1005 });
    expect(isSameCompetitor(a, b)).toBe(true);
  });

  it("treats same-named places far apart as different businesses", () => {
    const a = competitor({ name: "Glow Studio", distanceMeters: 500, latitude: 51.5, longitude: -0.1 });
    const b = competitor({ name: "Glow Studio", distanceMeters: 9000, latitude: 51.58, longitude: -0.12 });
    expect(isSameCompetitor(a, b)).toBe(false);
  });

  it("falls back to the distance delta when coordinates are missing", () => {
    expect(isSameCompetitor(competitor({ name: "Glow", distanceMeters: 500 }), competitor({ name: "Glow", distanceMeters: 600 }))).toBe(true);
    expect(isSameCompetitor(competitor({ name: "Glow", distanceMeters: 500 }), competitor({ name: "Glow", distanceMeters: 900 }))).toBe(false);
  });
});

describe("mergeCompetitors", () => {
  it("merges OSM data into a matching Google place", () => {
    const google = [
      competitor({
        name: "Glow Studio",
        distanceMeters: 400,
        latitude: 51.5,
        longitude: -0.1,
        sourceLabel: "Google Places",
        priceLevel: "$$",
        rating: 4.5,
        reviewCount: 120,
      }),
    ];
    const osm = [
      competitor({
        name: "Glow Studio",
        distanceMeters: 405,
        latitude: 51.5007,
        longitude: -0.1004,
        sourceLabel: "OpenStreetMap",
        phone: "+44 20 1234 5678",
        priceSamples: ["£40"],
      }),
    ];
    const merged = mergeCompetitors(google, osm);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.phone).toBe("+44 20 1234 5678");
    expect(merged[0]?.priceSamples).toContain("£40");
    expect(merged[0]?.rating).toBe(4.5);
    expect(merged[0]?.sourceLabel).toBe("Google Places");
  });

  it("appends OSM places not found in Google and sorts by distance", () => {
    const google = [competitor({ name: "Glow Studio", distanceMeters: 900, sourceLabel: "Google Places" })];
    const osm = [competitor({ name: "Luxe Cuts", distanceMeters: 300, sourceLabel: "OpenStreetMap" })];
    const merged = mergeCompetitors(google, osm);
    expect(merged.map((c) => c.name)).toEqual(["Luxe Cuts", "Glow Studio"]);
  });

  it("caps the merged list at 12 competitors", () => {
    const google = Array.from({ length: 8 }, (_, i) =>
      competitor({ name: `Salon ${i}`, distanceMeters: i * 100, sourceLabel: "Google Places" }),
    );
    const osm = Array.from({ length: 8 }, (_, i) =>
      competitor({ name: `Cut ${i}`, distanceMeters: 10_000 + i * 100, sourceLabel: "OpenStreetMap" }),
    );
    expect(mergeCompetitors(google, osm)).toHaveLength(12);
  });
});

describe("readJsonLdEvidence", () => {
  it("extracts prices from visible page text", () => {
    const html = `<html><body><h1>Glow Studio</h1><p>Haircut £45 · Colour from $120</p></body></html>`;
    const evidence = readJsonLdEvidence(html);
    expect(evidence.prices).toEqual(["£45", "$120"]);
  });

  it("parses aggregateRating and review body from JSON-LD", () => {
    const html = `
      <script type="application/ld+json">
      {
        "@type": "BeautySalon",
        "aggregateRating": { "ratingValue": "4.7", "reviewCount": 88 },
        "review": { "reviewBody": "Fast and friendly, no waiting." }
      }
      </script>`;
    const evidence = readJsonLdEvidence(html);
    expect(evidence.rating).toBe(4.7);
    expect(evidence.reviewCount).toBe(88);
    expect(evidence.reviewQuote).toBe("Fast and friendly, no waiting.");
  });

  it("ignores malformed JSON-LD blocks", () => {
    const html = `<script type="application/ld+json">{ not json </script><p>Haircut $25</p>`;
    const evidence = readJsonLdEvidence(html);
    expect(evidence.rating).toBeUndefined();
    expect(evidence.prices).toEqual(["$25"]);
  });
});

describe("buildEvidenceBrief (fallback used when no LLM key)", () => {
  const input = { businessName: "Radiance Salon", location: "Shoreditch, London", businessType: "salon" };

  it("reports published prices when evidence exists", () => {
    const priced = competitor({
      name: "Glow Studio",
      distanceMeters: 700,
      sourceLabel: "OpenStreetMap",
      priceSamples: ["£45"],
    });
    const brief = buildEvidenceBrief(input, snapshot([priced]));
    expect(brief.title).toBe("Radiance Salon, Shoreditch, London");
    expect(brief.signals).toHaveLength(3);
    expect(brief.signals[0]?.tone).toBe("amber");
    expect(brief.signals[0]?.headline).toContain("£45");
  });

  it("says pricing is unavailable instead of inventing numbers", () => {
    const plain = competitor({ name: "Glow Studio", distanceMeters: 700, sourceLabel: "OpenStreetMap" });
    const brief = buildEvidenceBrief(input, snapshot([plain]));
    expect(brief.signals[0]?.headline).toBe("No public competitor prices were found");
  });

  it("names the nearest competitor in the market signal", () => {
    const nearest = competitor({ name: "Luxe Cuts", distanceMeters: 300, sourceLabel: "OpenStreetMap" });
    const brief = buildEvidenceBrief(input, snapshot([nearest]));
    expect(brief.signals[2]?.headline).toBe("1 named salon businesses found nearby");
    expect(brief.signals[2]?.detail).toContain("Luxe Cuts");
  });
});