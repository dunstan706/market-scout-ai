import { describe, expect, it } from "vitest";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit.server";

describe("checkRateLimit", () => {
  it("allows requests under the limit and blocks beyond it", () => {
    expect(checkRateLimit("t:allow", 3, 60_000).allowed).toBe(true);
    expect(checkRateLimit("t:allow", 3, 60_000).allowed).toBe(true);
    expect(checkRateLimit("t:allow", 3, 60_000).allowed).toBe(true);
    expect(checkRateLimit("t:allow", 3, 60_000).allowed).toBe(false);
  });

  it("tracks keys independently", () => {
    expect(checkRateLimit("t:a", 1, 60_000).allowed).toBe(true);
    expect(checkRateLimit("t:b", 1, 60_000).allowed).toBe(true);
  });

  it("reports a retry delay inside the window when blocked", () => {
    checkRateLimit("t:retry", 2, 10_000);
    checkRateLimit("t:retry", 2, 10_000);
    const blocked = checkRateLimit("t:retry", 2, 10_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(10);
  });
});

describe("clientIpFromRequest", () => {
  it("reads the first hop of x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientIpFromRequest(request)).toBe("1.2.3.4");
  });

  it("falls back to cf-connecting-ip then x-real-ip", () => {
    const cf = new Request("https://example.com", { headers: { "cf-connecting-ip": "9.9.9.9" } });
    expect(clientIpFromRequest(cf)).toBe("9.9.9.9");
    const real = new Request("https://example.com", { headers: { "x-real-ip": "8.8.8.8" } });
    expect(clientIpFromRequest(real)).toBe("8.8.8.8");
  });

  it("returns undefined when no IP headers exist", () => {
    expect(clientIpFromRequest(new Request("https://example.com"))).toBeUndefined();
  });
});