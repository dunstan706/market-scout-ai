// Paddle Billing integration (merchant of record). Sandbox/live is selected
// by PADDLE_ENV; every call reads the API key from the environment at
// request time — nothing is ever hardcoded. Checkout uses catalog prices when
// configured (PADDLE_PRICE_*), otherwise inline (non-catalog) prices — both
// map back through PLAN_BY_PRICE at the webhook because amounts are identical.
//
// IMPORTANT: creating any transaction requires the account to have a default
// payment link set in the Paddle dashboard (checkout settings). Without it
// Paddle rejects with transaction_default_checkout_url_not_set.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cacheGet, cacheSet } from "@/lib/cache.server";

const SANDBOX_API_BASE = "https://sandbox-api.paddle.com";
const LIVE_API_BASE = "https://api.paddle.com";
const SANDBOX_CHECKOUT_BASE = "https://sandbox-checkout.paddle.com/checkout/custom/cyo_";
const LIVE_CHECKOUT_BASE = "https://checkout.paddle.com/checkout/custom/cyo_";

// Price amounts in the smallest currency unit (cents), USD. These are the
// *only* four plans sellable — the webhook maps payment events back to tiers
// through the same table (PLAN_BY_PRICE), so a mismatched amount can never
// grant a plan.
export const PADDLE_PRICES = {
  watch: { monthly: 1_500, yearly: 14_400 },
  advise: { monthly: 5_000, yearly: 48_000 },
} as const;

// Catalog price IDs when the dashboard catalog exists (created via MCP).
// Optional: checkout falls back to inline pricing when unset.
export type PaddleCatalogPrices = {
  watchMonthly?: string;
  watchYearly?: string;
  adviseMonthly?: string;
  adviseYearly?: string;
};

export type PaddleTier = keyof typeof PADDLE_PRICES;
export type PaddleCadence = "monthly" | "yearly";

export function paddleApiBase(): string {
  return process.env["PADDLE_ENV"] === "live" ? LIVE_API_BASE : SANDBOX_API_BASE;
}

function paddleCheckoutBase(): string {
  return process.env["PADDLE_ENV"] === "live" ? LIVE_CHECKOUT_BASE : SANDBOX_CHECKOUT_BASE;
}

// Client-side token for Paddle.js (checkout overlay on the pricing page).
// Dashboard → Developer tools → Authentication → Client-side tokens.
export function paddleClientToken(): string | undefined {
  const token = process.env["PADDLE_CLIENT_TOKEN"]?.trim();
  return token ? token : undefined;
}

// Catalog price ID for a tier/cadence, or undefined to fall back to inline
// pricing at checkout.
export function catalogPriceId(tier: PaddleTier, cadence: PaddleCadence): string | undefined {
  const envKey =
    tier === "watch"
      ? cadence === "monthly"
        ? "PADDLE_PRICE_WATCH_MONTHLY"
        : "PADDLE_PRICE_WATCH_YEARLY"
      : cadence === "monthly"
        ? "PADDLE_PRICE_ADVISE_MONTHLY"
        : "PADDLE_PRICE_ADVISE_YEARLY";
  const id = process.env[envKey]?.trim();
  return id ? id : undefined;
}

export function paddleApiKey(): string | undefined {
  const key = process.env["PADDLE_API_KEY"]?.trim();
  return key ? key : undefined;
}

export function isPaddleConfigured(): boolean {
  return Boolean(paddleApiKey());
}

type PaddleResponse<T> = {
  data?: T;
  error?: { type?: string; code?: string; detail?: string };
};

export async function paddleRequest<T>(
  method: "POST" | "GET",
  path: string,
  body?: unknown,
): Promise<{ data?: T | undefined; error?: string }> {
  const apiKey = paddleApiKey();
  if (!apiKey) return { error: "Paddle is not configured." };
  try {
    const response = await fetch(`${paddleApiBase()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json()) as PaddleResponse<T>;
    if (!response.ok || payload.error) {
      const detail = payload.error?.detail ?? payload.error?.code ?? `HTTP ${response.status}`;
      return { error: `Paddle API error: ${detail}` };
    }
    return { data: payload.data };
  } catch (error) {
    return {
      error: error instanceof Error ? `Could not reach Paddle: ${error.message}` : "Could not reach Paddle.",
    };
  }
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

// Creates a subscription checkout for the chosen tier/cadence and returns the
// hosted checkout URL. Uses the catalog price ID when configured, otherwise
// inline (non-catalog) pricing — both map back through PLAN_BY_PRICE at the
// webhook because the amounts are identical. `userId` rides through
// custom_data → webhook so the plan lands on the right profile.
export async function createPaddleCheckout(options: {
  userId: string;
  userEmail: string;
  tier: PaddleTier;
  cadence: PaddleCadence;
}): Promise<CheckoutResult> {
  const amount = PADDLE_PRICES[options.tier][options.cadence];
  const name = options.tier === "watch" ? "theBizScope Watch" : "theBizScope Advise";
  const description =
    options.tier === "watch"
      ? "Weekly market briefs for one business: competitor prices, reviews, opening hours, and new local developments."
      : "Everything in Watch for up to 5 businesses: real-time market alerts, price-position analysis, richer weekly briefs.";

  const catalogPriceId = catalogPriceFor(options.tier, options.cadence);
  const item = catalogPriceId
    ? { quantity: 1, price_id: catalogPriceId }
    : {
        quantity: 1,
        price: {
          description: `${name} (${options.cadence})`,
          type: "standard",
          tax_category: "saas",
          unit_price: { amount: String(amount), currency_code: "USD" },
          billing_cycle:
            options.cadence === "yearly"
              ? { interval: "year", frequency: 1 }
              : { interval: "month", frequency: 1 },
          product: { name, tax_category: "saas" },
        },
      };

  const { data, error } = await paddleRequest<{ id: string; checkout_url?: string }>("POST", "/transactions", {
    items: [item],
    currency_code: "USD",
    collection_mode: "automatic",
    checkout: { email: options.userEmail },
    custom_data: { user_id: options.userId, tier: options.tier, cadence: options.cadence },
  });
  if (error || !data) return { ok: false, error: error ?? "Paddle did not return a transaction." };

  const url = data.checkout_url ?? `${paddleCheckoutBase()}${data.id}`;
  return { ok: true, url };
}

function catalogPriceFor(tier: PaddleTier, cadence: PaddleCadence): string | undefined {
  return catalogPriceId(tier, cadence);
}

export type PortalResult = { ok: true; url: string } | { ok: false; error: string };

// --- Localized pricing preview (for the pricing page) ---
// Paddle returns tax-inclusive totals per country: localized currency when
// unit-price overrides exist, otherwise the base currency with the country's
// tax rate applied. These are the exact totals the checkout will charge.
export type LocalizedPrice = {
  tier: PaddleTier;
  cadence: PaddleCadence;
  /** Tax-inclusive total formatted by Paddle for the visitor's country, e.g.
   *  "$15.00" or "kr158,63" once currency overrides are configured. */
  formattedTotal: string;
  currencyCode: string;
  /** Tax rate applied for the country, e.g. "0.25" for Swedish VAT. */
  taxRate: string | null;
  /** Two-letter country the price was localized for, when known. */
  country?: string | null;
};

const PRICING_PREVIEW_TTL_MS = 5 * 60 * 1000;

export async function previewLocalizedPricing(options: {
  /** Two-letter country code, or null to let Paddle resolve from IP. */
  countryCode: string | null;
  /** Visitor IP — used when countryCode is null so Paddle geo-resolves. */
  customerIp?: string | undefined;
  cadence: PaddleCadence;
}): Promise<{ prices: LocalizedPrice[]; countryError?: string | undefined }> {
  // Cache per country/IP+cadence: pricing previews cost an API round-trip
  // each, and the numbers only change with catalog edits or tax updates.
  const geoKey = options.countryCode ?? options.customerIp ?? "unknown";
  const cacheKey = `paddle-preview:${geoKey}:${options.cadence}`;
  const cached = cacheGet<{ prices: LocalizedPrice[]; countryError?: string }>(cacheKey);
  if (cached) return cached;

  const tiers: PaddleTier[] = ["watch", "advise"];
  const prices = await Promise.all(
    tiers.map(async (tier) => {
      const priceId = catalogPriceId(tier, options.cadence);
      const item = priceId
        ? { price_id: priceId, quantity: 1 }
        : {
            quantity: 1,
            price: {
              name: `${tier} ${options.cadence}`,
              description: `theBizScope ${tier} (${options.cadence})`,
              type: "standard" as const,
              tax_category: "saas",
              unit_price: {
                amount: String(PADDLE_PRICES[tier][options.cadence]),
                currency_code: "USD",
              },
              billing_cycle:
                options.cadence === "yearly"
                  ? { interval: "year" as const, frequency: 1 }
                  : { interval: "month" as const, frequency: 1 },
              product: { name: tier === "watch" ? "theBizScope Watch" : "theBizScope Advise", tax_category: "saas" },
            },
          };

      const { data, error } = await paddleRequest<LocalizedPreviewResponse>(
        "POST",
        "/pricing-preview",
        {
          items: [item],
          ...(options.countryCode
            ? { address: { country_code: options.countryCode } }
            : { customer_ip_address: options.customerIp }),
        },
      );
      if (error || !data) {
        return { tier, cadence: options.cadence, error: error ?? "no data" } as const;
      }
      const line = data.details?.line_items?.[0];
      const total = line?.formatted_totals?.total;
      if (!total) {
        return { tier, cadence: options.cadence, error: "missing totals" } as const;
      }
      return {
        tier,
        cadence: options.cadence,
        price: {
          tier,
          cadence: options.cadence,
          formattedTotal: total,
          currencyCode: line?.price?.unit_price?.currency_code ?? data.currency_code ?? "USD",
          taxRate: line?.tax_rate ?? null,
          country: options.countryCode,
        } satisfies LocalizedPrice,
      } as const;
    }),
  );

  const okPrices: LocalizedPrice[] = [];
  let firstError: string | undefined;
  for (const result of prices) {
    if ("price" in result) okPrices.push(result.price);
    else firstError ??= result.error;
  }
  const result = { prices: okPrices, countryError: firstError };
  // Cache even partial failures briefly — avoids hammering Paddle when a
  // price is misconfigured; the short TTL self-heals.
  return cacheSet(cacheKey, result, PRICING_PREVIEW_TTL_MS);
}

type LocalizedPreviewResponse = {
  currency_code?: string;
  details?: {
    line_items?: Array<{
      tax_rate?: string;
      price?: { unit_price?: { amount?: string; currency_code?: string } } | null;
      formatted_totals?: { total?: string };
    }>;
  } | null;
};

// Generates a short-lived authenticated link to Paddle's hosted customer
// portal (manage payment method, invoices, cancel).
export async function createPaddlePortalSession(options: {
  paddleCustomerId: string;
}): Promise<PortalResult> {
  const { data, error } = await paddleRequest<{ urls?: { general?: { overview?: string } } }>(
    "POST",
    `/customers/${encodeURIComponent(options.paddleCustomerId)}/portal-sessions`,
    {},
  );
  const url = data?.urls?.general?.overview;
  if (error || !url) {
    return { ok: false, error: error ?? "Could not open the billing portal." };
  }
  return { ok: true, url };
}

// --- Webhook signature verification ---
// Matches Paddle's official SDK: the `Paddle-Signature` header carries
// `ts=<unix>;h1=<hex>`, where h1 is HMAC-SHA256 of `${ts}:${rawBody}` keyed
// with the webhook secret. The timestamp window bounds replay attacks.
const SIGNATURE_MAX_AGE_SECONDS = 300;

export function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  let ts = 0;
  let h1 = "";
  for (const part of signatureHeader.split(";")) {
    const [key, value] = part.split("=");
    if (key === "ts" && value) ts = Number.parseInt(value, 10);
    if (key === "h1" && value) h1 = value;
  }
  if (!ts || !h1) return false;

  const age = Math.floor(Date.now() / 1000) - ts;
  if (age > SIGNATURE_MAX_AGE_SECONDS || age < -SIGNATURE_MAX_AGE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(h1, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Plan mapping (amounts from PADDLE_PRICES) ---
// Amounts in minor units, keyed by billing interval. Unknown combinations are
// ignored rather than guessed.
export type PlanMapping = { tier: "watch" | "advise"; cadence: "monthly" | "yearly" };

export const PLAN_BY_PRICE: Record<string, PlanMapping> = {
  "1500:month": { tier: "watch", cadence: "monthly" },
  "14400:year": { tier: "watch", cadence: "yearly" },
  "5000:month": { tier: "advise", cadence: "monthly" },
  "48000:year": { tier: "advise", cadence: "yearly" },
};

// --- Access gating ---
// Whether a subscription status currently grants paid access. Cancellations
// scheduled for the period end keep status `active` until Paddle flips it to
// `canceled`, so a scheduled_change alone never revokes access. Paused
// subscriptions revoke immediately (the customer chose to pause); past_due
// keeps access while Paddle retries the payment (dunning grace) — Paddle
// only moves it to `canceled` if all retries fail.
export function subscriptionGrantsAccess(status: string | null | undefined): boolean {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
      return true;
    case "canceled":
    case "paused":
      return false;
    default:
      return false;
  }
}

export type PaddleSubscriptionItems = {
  items?: Array<{
    price?: {
      billing_cycle?: { interval?: string; frequency?: number } | null;
      unit_price?: { amount?: string; currency_code?: string } | null;
    } | null;
  }> | null;
};

export function planFromSubscription(sub: PaddleSubscriptionItems): PlanMapping | null {
  const price = sub.items?.[0]?.price;
  const amount = price?.unit_price?.amount;
  const interval = price?.billing_cycle?.interval;
  if (!amount || (interval !== "month" && interval !== "year")) return null;
  return PLAN_BY_PRICE[`${amount}:${interval}`] ?? null;
}
