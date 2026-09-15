// Security headers applied to every server response in src/server.ts.
//
// CSP deliberately OMITS script-src: TanStack Start hydration relies on
// inline <script> payloads and Lovable injects its own runtime scripts, so a
// static script-src would require nonce plumbing through the SSR pipeline.
// Everything else is locked down. If script-src is added later it must be
// tested against the Lovable build first (hydration + Lovable devtools).

const FONT_CSS_HOST = "https://fonts.googleapis.com";
const FONT_FILE_HOST = "https://fonts.gstatic.com";

// Paddle's checkout overlay injects its own stylesheet at runtime.
const PADDLE_CSS_HOST = "https://sandbox-cdn.paddle.com https://cdn.paddle.com";

// Checkout overlay iframes (live first; sandbox kept so testing still works
// while PADDLE_ENV=sandbox).
const PADDLE_FRAME_HOSTS = [
  "https://buy.paddle.com",
  "https://checkout.paddle.com",
  "https://sandbox-checkout.paddle.com",
  "https://sandbox-buy.paddle.com",
];

// Paddle.js is injected at runtime from their CDN.
const PADDLE_SCRIPT_HOST = "https://cdn.paddle.com";

// The Lovable preview pane embeds the site in an iframe; publishing/preview
// break without these ancestors.
const FRAME_ANCESTORS = ["'self'", "https://lovable.app", "https://lovable.dev"];

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
    // 'unsafe-inline' for scripts is REQUIRED: TanStack Start SSR ships its
    // hydration bootstrap as inline scripts (window.$_TSR) and Lovable
    // injects runtime inline scripts. Blocking them white-screens every page
    // (reproduced in the browser). The CDN host is Paddle.js. No 'unsafe-eval'.
    `script-src 'self' 'unsafe-inline' ${PADDLE_SCRIPT_HOST}`,
    // Inline styles are required for Tailwind/SSR-injected styles; styles
    // otherwise load from self + Google Fonts + Paddle's checkout CSS.
    `style-src 'self' 'unsafe-inline' ${FONT_CSS_HOST} ${PADDLE_CSS_HOST}`,
    `font-src 'self' ${FONT_FILE_HOST} data:`,
    `img-src 'self' data:`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${frameSrc.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Clickjacking defense; allows the Lovable preview pane.
    `frame-ancestors ${FRAME_ANCESTORS.join(" ")}`,
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    // No X-Frame-Options: CSP frame-ancestors (above) is the modern control
    // and XFO DENY would additionally break the Lovable preview pane.
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
