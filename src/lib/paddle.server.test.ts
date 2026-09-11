import { describe, expect, it } from "vitest";
import {
  PADDLE_PRICES,
  PLAN_BY_PRICE,
  planFromSubscription,
  subscriptionGrantsAccess,
  verifyPaddleSignature,
} from "@/lib/paddle.server";
import { createHmac } from "node:crypto";

describe("subscriptionGrantsAccess", () => {
  it("grants access for active, trialing, and past_due (dunning grace)", () => {
    expect(subscriptionGrantsAccess("active")).toBe(true);
    expect(subscriptionGrantsAccess("trialing")).toBe(true);
    expect(subscriptionGrantsAccess("past_due")).toBe(true);
  });

  it("revokes access for canceled and paused", () => {
    expect(subscriptionGrantsAccess("canceled")).toBe(false);
    expect(subscriptionGrantsAccess("paused")).toBe(false);
  });

  it("revokes access for unknown or missing statuses", () => {
    expect(subscriptionGrantsAccess("weird")).toBe(false);
    expect(subscriptionGrantsAccess(null)).toBe(false);
    expect(subscriptionGrantsAccess(undefined)).toBe(false);
  });
});

describe("PADDLE_PRICES", () => {
  it("matches the landing/overlay pricing", () => {
    expect(PADDLE_PRICES.watch.monthly).toBe(1_500);
    expect(PADDLE_PRICES.watch.yearly).toBe(14_400);
    expect(PADDLE_PRICES.advise.monthly).toBe(5_000);
    expect(PADDLE_PRICES.advise.yearly).toBe(48_000);
  });
});

describe("planFromSubscription", () => {
  it("maps the four sellable price/interval combos", () => {
    const sub = (amount: string, interval: "month" | "year") => ({
      items: [{ price: { unit_price: { amount, currency_code: "USD" }, billing_cycle: { interval, frequency: 1 } } }],
    });
    expect(planFromSubscription(sub("1500", "month"))).toEqual({ tier: "watch", cadence: "monthly" });
    expect(planFromSubscription(sub("14400", "year"))).toEqual({ tier: "watch", cadence: "yearly" });
    expect(planFromSubscription(sub("5000", "month"))).toEqual({ tier: "advise", cadence: "monthly" });
    expect(planFromSubscription(sub("48000", "year"))).toEqual({ tier: "advise", cadence: "yearly" });
  });

  it("returns null for unknown amounts or malformed items", () => {
    const sub = { items: [{ price: { unit_price: { amount: "999", currency_code: "USD" }, billing_cycle: { interval: "month", frequency: 1 } } }] };
    expect(planFromSubscription(sub)).toBeNull();
    expect(planFromSubscription({ items: [] })).toBeNull();
    expect(planFromSubscription({})).toBeNull();
  });

  it("keeps PLAN_BY_PRICE consistent with PADDLE_PRICES", () => {
    expect(Object.keys(PLAN_BY_PRICE)).toHaveLength(4);
    expect(PLAN_BY_PRICE["1500:month"]).toEqual({ tier: "watch", cadence: "monthly" });
  });
});

describe("verifyPaddleSignature", () => {
  const secret = "pdl_ntfset_01hexamplesecret";
  const body = JSON.stringify({ event_type: "subscription.created", data: { id: "sub_1" } });

  it("accepts a fresh, correctly signed request", () => {
    const ts = Math.floor(Date.now() / 1000);
    const h1 = createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
    expect(verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ts = Math.floor(Date.now() / 1000);
    const h1 = createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
    expect(verifyPaddleSignature(body + " ", `ts=${ts};h1=${h1}`, secret)).toBe(false);
  });

  it("rejects stale timestamps (replay window)", () => {
    const ts = Math.floor(Date.now() / 1000) - 400;
    const h1 = createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
    expect(verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, secret)).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyPaddleSignature(body, null, secret)).toBe(false);
    expect(verifyPaddleSignature(body, "ts=abc;h1=zzz", secret)).toBe(false);
    expect(verifyPaddleSignature(body, "", secret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const ts = Math.floor(Date.now() / 1000);
    const h1 = createHmac("sha256", "other-secret").update(`${ts}:${body}`).digest("hex");
    expect(verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, secret)).toBe(false);
  });
});
