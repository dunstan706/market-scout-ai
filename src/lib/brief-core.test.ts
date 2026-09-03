import { describe, expect, it } from "vitest";
import { BriefInput, normalizeLooseBrief } from "@/lib/brief-core";

function signal(tone: string) {
  return { tone, label: "Price move", headline: "Glow dropped prices 15%", detail: "From Google." };
}

const valid = {
  title: "Glow Studio, London",
  signals: [signal("red"), signal("amber"), signal("green")],
  recommendation: "Run a weekday promo.",
  why: "Because afternoons are exposed.",
};

describe("BriefInput", () => {
  it("accepts a minimal valid brief request", () => {
    const parsed = BriefInput.parse({ businessName: "Glow Studio", location: "Shoreditch, London", businessType: "salon" });
    expect(parsed.businessType).toBe("salon");
    expect(parsed.website).toBeUndefined();
  });

  it("accepts the honeypot field", () => {
    const parsed = BriefInput.parse({
      businessName: "Glow Studio",
      location: "London",
      website: "http://spam.example",
    });
    expect(parsed.website).toBe("http://spam.example");
  });

  it("defaults the business type to salon", () => {
    const parsed = BriefInput.parse({ businessName: "Glow Studio", location: "London" });
    expect(parsed.businessType).toBe("salon");
  });

  it("rejects names shorter than 2 characters", () => {
    expect(() => BriefInput.parse({ businessName: "G", location: "London" })).toThrow();
  });

  it("rejects unknown business types", () => {
    expect(() => BriefInput.parse({ businessName: "Gym", location: "London", businessType: "gym" })).toThrow();
  });

  it("rejects missing locations", () => {
    expect(() => BriefInput.parse({ businessName: "Glow Studio" })).toThrow();
  });
});

describe("normalizeLooseBrief", () => {
  it("accepts a well-formed brief", () => {
    const brief = normalizeLooseBrief(valid);
    expect(brief?.signals.map((s) => s.tone)).toEqual(["red", "amber", "green"]);
    expect(brief?.title).toBe("Glow Studio, London");
  });

  it("tolerates uppercase tones", () => {
    const brief = normalizeLooseBrief({ ...valid, signals: [signal("Red")] });
    expect(brief?.signals[0]?.tone).toBe("red");
  });

  it("slices to at most three signals", () => {
    const brief = normalizeLooseBrief({
      ...valid,
      signals: [signal("red"), signal("amber"), signal("green"), signal("red")],
    });
    expect(brief?.signals).toHaveLength(3);
  });

  it("rejects a brief with no recognizable tones", () => {
    expect(normalizeLooseBrief({ ...valid, signals: [{ ...signal("red"), tone: "blue" }] })).toBeNull();
  });

  it("returns null for non-object output", () => {
    expect(normalizeLooseBrief("nope")).toBeNull();
    expect(normalizeLooseBrief(null)).toBeNull();
    expect(normalizeLooseBrief(undefined)).toBeNull();
  });
});