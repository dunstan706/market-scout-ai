// Security headers applied to every server response in src/server.ts.
//
// CSP deliberately OMITS script-src: TanStack Start hydration relies on
// inline <script> payloads and Lovable injects its own runtime scripts, so a
// static script-src would require nonce plumbing through the SSR pipeline.
// Everything else is locked down. If script-src is added later it must be
// tested against the Lovable build first (hydration + Lovable devtools).

const FONT_CSS_HOST = "https://fonts.googleapis.com";
const FONT_FILE_HOST = "https://fonts.gstatic.com";

// Checkout overlay iframes (live first; sandbox kept so testing still works
// while PADDLE_ENV=sandbox).
const PADDLE_FRAME_HOSTS = [
  "https://buy.paddle.com",
  "https://checkout.paddle.com",
  "https://sandbox-checkout.paddle.com",
  "https://sandbox-buy.paddle.com",
];

function supabaseOrigins(): string[] {
  const url =
    process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"] ?? "";
  const origins: string[] = [];
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") origins.push(parsed.origin);
  } catch {
    // Unset/invalid env — omit rather than emit a broken policy.
  }
  return origins;
}

export function buildSecurityHeaders(): Record<string, string> {
  const connectSrc = ["'self'", ...supabaseOrigins()];
  const frameSrc = [...PADDLE_FRAME_HOSTS, ...supabaseOrigins()];

  const csp = [
    "default-src 'self'",
    // Inline styles are required for Tailwind/SSR-injected styles; styles
    // otherwise load from self + Google Fonts.
    `style-src 'self' 'unsafe-inline' ${FONT_CSS_HOST}`,
    `font-src 'self' ${FONT_FILE_HOST} data:`,
    `img-src 'self' data:`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${frameSrc.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Clickjacking: block all framing (belt) + CSP directive (suspenders).
    "frame-ancestors 'none'",
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    // Least-surprise permissions: the site needs none of these.
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(self)",
  };
}

// Response header names that must not survive a header merge from the inner
// handler: a proxied content-encoding/length pair describes the ORIGINAL
// stream. Once we detach and re-read the body we are responsible for them —
// keeping the old values produces mismatched-length responses.
const INCOMPATIBLE_RESPONSE_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "cross-origin-opener-policy",
  "permissions-policy",
];

export function applySecurityHeaders(response: Response): Response {
  const security = buildSecurityHeaders();
  const headers = new Headers(response.headers);
  for (const name of INCOMPATIBLE_RESPONSE_HEADERS) headers.delete(name);

  // Stream the original body through untouched — the wrapper never buffers,
  // so chunked transfer replaces the (now-deleted) length headers.
  const body: BodyInit = response.body ?? "";

  for (const [name, value] of Object.entries(security)) headers.set(name, value);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
