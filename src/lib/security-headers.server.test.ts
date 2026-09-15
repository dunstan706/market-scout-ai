import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "./security-headers.server";

// Guardrails for the global security-header layer: if one of these fails,
// either the policy regressed or a new deployment surface needs a deliberate
// CSP decision (document it in security-headers.server.ts, don't delete the
// assertion).
describe("buildSecurityHeaders", () => {
  const headers = buildSecurityHeaders();
  const csp = headers["Content-Security-Policy"] ?? "";

  it("sets the hardening headers", () => {
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  it("locks the CSP baseline", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Clickjacking defense must never regress.
    expect(csp).not.toContain("frame-ancestors *");
  });

  it("keeps the sandbox and live Paddle checkout frames allowed", () => {
    expect(csp).toContain("https://buy.paddle.com");
    expect(csp).toContain("https://sandbox-checkout.paddle.com");
  });

  it("allows inline styles (SSR/Tailwind) but no other inline bypass", () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("derives Supabase origins from env when available", () => {
    const prev = process.env["VITE_SUPABASE_URL"];
    try {
      process.env["VITE_SUPABASE_URL"] = "https://example.supabase.co";
      const withEnv = buildSecurityHeaders();
      const cspWithEnv = withEnv["Content-Security-Policy"] ?? "";
      expect(cspWithEnv).toContain("https://example.supabase.co");
    } finally {
      if (prev === undefined) delete process.env["VITE_SUPABASE_URL"];
      else process.env["VITE_SUPABASE_URL"] = prev;
    }
  });

  it("emits a valid policy with no unset env", () => {
    // connect-src/frame-src must never end up with an empty directive value.
    expect(csp).toMatch(/connect-src \S+/);
    expect(csp).toMatch(/frame-src \S+/);
  });
});
