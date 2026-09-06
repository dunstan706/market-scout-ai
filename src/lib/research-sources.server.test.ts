import { describe, expect, it } from "vitest";
import {
  dedupeByPlace,
  resultCapsFor,
  WEEKLY_MAIL_NOTE,
  type ResearchCompetitor,
} from "@/lib/research-sources.server";

function competitor(
  partial: Partial<ResearchCompetitor> & { name: string; distanceMeters: number },
): ResearchCompetitor {
  const { name, distanceMeters, ...rest } = partial;
  return {
    name,
    distanceMeters,
    priceSamples: [],
    sourceUrl: "https://example.com",
    sourceLabel: "Test",
    ...rest,
  };
}

describe("resultCapsFor", () => {
  it("keeps preview caps conservative and below full caps", () => {
    const preview = resultCapsFor("preview");
    const full = resultCapsFor("full");
    for (const source of ["foursquare", "geoapify", "overture"] as const) {
      expect(preview[source]).toBeGreaterThan(0);
      expect(preview[source]).toBeLessThanOrEqual(full[source]);
    }
  });
});

describe("dedupeByPlace", () => {
  it("keeps genuinely different businesses", () => {
    const list = [
      competitor({ name: "Glow Studio", distanceMeters: 400, latitude: 51.5, longitude: -0.1 }),
      competitor({ name: "Luxe Cuts", distanceMeters: 800, latitude: 51.51, longitude: -0.11 }),
    ];
    expect(dedupeByPlace(list)).toHaveLength(2);
  });

  it("merges the same business found by two sources at ~the same spot", () => {
    const list = [
      competitor({
        name: "Glow Studio",
        distanceMeters: 400,
        latitude: 51.5,
        longitude: -0.1,
        sourceLabel: "Foursquare Places",
      }),
      competitor({
        name: "Glow Studio Salon",
        distanceMeters: 405,
        latitude: 51.5007,
        longitude: -0.1004,
        sourceLabel: "Overture Maps",
      }),
    ];
    expect(dedupeByPlace(list)).toHaveLength(1);
  });

  it("keeps the nearer of two same-named places far apart", () => {
    const list = [
      competitor({ name: "Glow Studio", distanceMeters: 900, latitude: 51.5, longitude: -0.1 }),
      competitor({ name: "Glow Studio", distanceMeters: 9000, latitude: 51.58, longitude: -0.12 }),
    ];
    expect(dedupeByPlace(list)).toHaveLength(2);
  });
});

describe("WEEKLY_MAIL_NOTE", () => {
  it("points every preview at the richer weekly mail", () => {
    expect(WEEKLY_MAIL_NOTE.toLowerCase()).toContain("weekly");
    expect(WEEKLY_MAIL_NOTE.toLowerCase()).toContain("email");
  });
});
