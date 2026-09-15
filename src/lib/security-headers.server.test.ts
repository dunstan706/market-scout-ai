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
    // No X-Frame-Options by design: CSP frame-ancestors covers clickjacking
    // while still allowing the Lovable preview pane.
    expect(headers["X-Frame-Options"]).toBeUndefined();
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  it("locks the CSP baseline", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    // Clickjacking defense: framing restricted, never wide open.
    expect(csp).toMatch(/frame-ancestors 'self'[^;]*|frame-ancestors [^;]*lovable/);
    expect(csp).not.toContain("frame-ancestors *");
    expect(csp).not.toContain("frame-ancestors 'none'");
  });

  it("keeps the sandbox and live Paddle checkout frames allowed", () => {
    expect(csp).toContain("https://buy.paddle.com");
    expect(csp).toContain("https://sandbox-checkout.paddle.com");
  });

  it("allows inline scripts and the Paddle CDN (hydration + checkout break without them)", () => {
    // Regression guard: the strict policy once white-screened every page by
    // blocking TanStack Start's inline bootstrap (window.$_TSR).
    expect(csp).toMatch(/script-src [^;]*'unsafe-inline'/);
    expect(csp).toContain("https://cdn.paddle.com");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("allows the Lovable preview pane to embed the site", () => {
    expect(csp).toMatch(/frame-ancestors [^;]*lovable/);
    expect(csp).not.toContain("frame-ancestors 'none'");
  });

  it("allows inline styles (SSR/Tailwind) but keeps eval locked", () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
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
