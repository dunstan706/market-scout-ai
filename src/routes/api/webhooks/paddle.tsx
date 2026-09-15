import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/webhooks/paddle")({
  staticData: { sitemap: false },
  // API-only route — never rendered as a page.
  component: () => null,
  server: {
    handlers: {
      POST: async ({ request }) => handlePaddleWebhook(request),
    },
  },
});

type PaddleEvent = {
  event_id?: string;
  event_type?: string;
  occurred_at?: string;
  data?: PaddleSubscription | PaddleTransaction;
};

type PaddleSubscription = {
  id?: string;
  status?: string;
  customer_id?: string;
  custom_data?: Record<string, unknown> | null;
  started_at?: string | null;
  current_billing_period?: { starts_at?: string; ends_at?: string } | null;
  next_billed_at?: string | null;
  items?: Array<{
    price?: {
      billing_cycle?: { interval?: string; frequency?: number } | null;
      unit_price?: { amount?: string; currency_code?: string } | null;
    } | null;
  }> | null;
};

type PaddleTransaction = {
  id?: string;
  status?: string;
  customer_id?: string;
  subscription_id?: string;
  custom_data?: Record<string, unknown> | null;
  currency_code?: string;
  details?: {
    totals?: { subtotal?: string } | null;
  } | null;
  items?: PaddleSubscription["items"];
};

type PaddleAdjustment = {
  id?: string;
  action?: string; // refund | chargeback | credit | ...
  transaction_id?: string;
};

type ProfileBillingRow = {
  id: string;
  paddle_customer_id?: string | null;
  paddle_subscription_id?: string | null;
  plan_tier?: string | null;
};

function jsonResponse(
  payload: { ok?: boolean; error?: string; received?: boolean },
  status = 200,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Locates the profile a subscription belongs to. Existing subscriptions use
// the stored Paddle customer id; first-time checkouts must carry a user id
// authenticated by the server-issued binding. Paddle customer email is never
// trusted as account ownership proof.
async function resolveProfileRow(
  supabaseAdmin: { from: (table: string) => any },
  sub: PaddleSubscription,
): Promise<ProfileBillingRow | null> {
  const customerId = sub.customer_id ?? null;
  if (customerId) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, paddle_customer_id, paddle_subscription_id, plan_tier")
      .eq("paddle_customer_id", customerId)
      .limit(1);
    const row = (data as ProfileBillingRow[] | null)?.[0];
    if (row) return row;
  }

  const customData = sub.custom_data ?? null;
  const customUserId =
    customData && typeof customData["user_id"] === "string" ? (customData["user_id"] as string) : null;
  const customBinding = customData?.["user_binding"];
  if (customUserId) {
    const { verifyCheckoutBinding } = await import("@/lib/paddle.server");
    if (!verifyCheckoutBinding(customUserId, customBinding)) {
      console.error("paddle webhook: rejected unsigned checkout account binding");
      return null;
    }
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, paddle_customer_id, paddle_subscription_id, plan_tier")
      .eq("id", customUserId)
      .limit(1);
    const row = (data as ProfileBillingRow[] | null)?.[0];
    if (row) return row;
  }

  return null;
}

// Maps a Paddle subscription onto the profile's billing columns.
//
// Access rules (see subscriptionGrantsAccess): canceled AND paused revoke —
// the profile lands back on the free tier — while active/trialing/past_due
// keep the mapped tier. A scheduled_change to cancel or pause does NOT
// revoke: status stays `active` until Paddle actually flips it, so access
// runs until the paid period ends.
//
// Out-of-order/idempotency guard: Paddle deliveries are at-least-once, and a
// resubscribe creates a NEW subscription id. Revocations from a subscription
// other than the one attached to the profile are ignored, so a delayed
// `subscription.canceled` for an old subscription can never strip a plan a
// newer subscription granted. Every handler is an update keyed on existing
// rows — replaying the same event produces the same result.
async function applySubscription(
  supabaseAdmin: { from: (table: string) => any },
  sub: PaddleSubscription,
): Promise<void> {
  const row = await resolveProfileRow(supabaseAdmin, sub);
  if (!row) {
    console.error("paddle webhook: no profile for subscription", sub.id, sub.customer_id);
    return;
  }

  const { subscriptionGrantsAccess } = await import("@/lib/paddle.server");
  const status = sub.status ?? "";
  const grants = subscriptionGrantsAccess(status);
  if (
    !grants &&
    sub.id &&
    row.paddle_subscription_id &&
    sub.id !== row.paddle_subscription_id
  ) {
    // Revocation from a different (older) subscription — ignore.
    return;
  }

  type ProfileBillingPatch = {
    paddle_customer_id?: string;
    paddle_subscription_id?: string;
    plan_tier?: "free" | "watch" | "advise";
    subscription_status?: string | null;
    billing_cadence?: "monthly" | "yearly" | null;
    current_period_end?: string | null;
  };
  const patch: ProfileBillingPatch = {};

  if (sub.customer_id && sub.customer_id !== row.paddle_customer_id) {
    patch.paddle_customer_id = sub.customer_id;
  }
  if (sub.id && sub.id !== row.paddle_subscription_id) {
    patch.paddle_subscription_id = sub.id;
  }

  if (!grants) {
    patch.plan_tier = "free";
    patch.subscription_status = status || "canceled";
    patch.billing_cadence = null;
    patch.current_period_end = null;
  } else {
    const { planFromSubscription } = await import("@/lib/paddle.server");
    const plan = planFromSubscription(sub);
    if (plan) {
      patch.plan_tier = plan.tier;
      patch.billing_cadence = plan.cadence;
    }
    patch.subscription_status = status || null;
    patch.current_period_end = sub.next_billed_at ?? sub.current_billing_period?.ends_at ?? null;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", row.id);
    if (error) throw new Error(error.message);
  }
}

// The generated Database type carries an empty Functions map (the affiliate
// RPCs are created by a raw SQL migration), so calls go through a
// string-typed overload.
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

async function callRpc(
  supabaseAdmin: { from: (table: string) => any },
  fn: string,
  args: Record<string, unknown>,
): Promise<{ error: { message: string } | null }> {
  return (supabaseAdmin as unknown as RpcClient).rpc(fn, args);
}

// Affiliate commission engine (see 20260914120000_add_affiliate_program.sql):
// 10% of each subscription payment (excl. tax) for referred customers during
// the first 12 months of their subscription. Attribution is locked at signup
// (affiliate_referrals), so checkout needed no changes — the user id that
// already rides in checkout custom_data (or the stored paddle customer
// mapping) identifies the buyer. Idempotent: commissions are unique per
// Paddle transaction id, so replayed deliveries never double-pay.
async function applyAffiliateCommission(
  supabaseAdmin: { from: (table: string) => any },
  tx: PaddleTransaction,
  occurredAt: string | null,
): Promise<void> {
  try {
    if (!tx.id) return;
    // Subscriptions only — the storefront sells no one-off purchases.
    if (!tx.subscription_id) return;

    const profile = await resolveProfileRow(supabaseAdmin, {
      ...(tx.customer_id ? { customer_id: tx.customer_id } : {}),
      custom_data: tx.custom_data ?? null,
    });
    if (!profile?.id) return;

    const { paddleRequest } = await import("@/lib/paddle.server");
    const { data: sub } = await paddleRequest<PaddleSubscription>(
      "GET",
      `/subscriptions/${encodeURIComponent(tx.subscription_id)}`,
    );
    if (!sub) return;
    const interval = sub.items?.[0]?.price?.billing_cycle?.interval;
    if (interval !== "month" && interval !== "year") return;

    // Payment number: 1 for the first payment, then one per cadence step
    // elapsed since the subscription start (renewals, upgrades included).
    const startRaw = sub.started_at ?? sub.current_billing_period?.starts_at ?? null;
    let paymentNumber = 1;
    if (startRaw && occurredAt) {
      const stepMs = interval === "month" ? 30.44 * 86_400_000 : 365.25 * 86_400_000;
      const elapsed = Date.parse(occurredAt) - Date.parse(startRaw);
      paymentNumber = Math.max(1, Math.floor(elapsed / stepMs) + 1);
    }

    // Commission basis: the payment subtotal excluding tax, major units.
    const subtotalMinor = tx.details?.totals?.subtotal;
    if (!subtotalMinor) return;
    const paymentAmount = Number.parseInt(subtotalMinor, 10) / 100;

    const { error } = await callRpc(supabaseAdmin, "record_affiliate_commission", {
      p_referred_user_id: profile.id,
      p_transaction_id: tx.id,
      p_payment_amount: paymentAmount,
      p_payment_number: paymentNumber,
      p_subscription_start: startRaw,
      p_event_time: occurredAt,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    // A commission failure must never fail the webhook — fulfillment (the
    // subscription apply) has already happened by this point.
    console.error("affiliate commission failed", error instanceof Error ? error.message : error);
  }
}

async function handlePaddleWebhook(request: Request): Promise<Response> {
  // Defense in depth for the live account: Paddle sends webhooks only from
  // its published IP ranges, so non-Paddle sources are dropped before any
  // processing. Signature verification below remains the authoritative check.
  const { rejectPaddleWebhookSource } = await import("@/lib/paddle-webhook-ip.server");
  const sourceRejection = await rejectPaddleWebhookSource(request);
  if (sourceRejection) {
    console.warn("paddle webhook:", sourceRejection);
    return jsonResponse({ error: "Forbidden." }, 403);
  }

  const secret = process.env["PADDLE_WEBHOOK_SECRET"]?.trim();
  if (!secret) {
    console.error("paddle webhook: PADDLE_WEBHOOK_SECRET is not set");
    return jsonResponse({ error: "Webhook is not configured." }, 500);
  }

  const rawBody = await request.text();
  const { verifyPaddleSignature } = await import("@/lib/paddle.server");
  if (!verifyPaddleSignature(rawBody, request.headers.get("paddle-signature"), secret)) {
    return jsonResponse({ error: "Invalid signature." }, 401);
  }

  let event: PaddleEvent;
  try {
    event = JSON.parse(rawBody) as PaddleEvent;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const eventType = event.event_type ?? "";

  try {
    if (eventType.startsWith("subscription.")) {
      const sub = event.data as PaddleSubscription;
      if (!sub.id) return jsonResponse({ error: "Missing subscription id." }, 400);
      // created/updated/canceled all flow through one path: canceled lands as
      // the free tier; created/updated map the tier from the price amount.
      await applySubscription(supabaseAdmin, sub);
      return jsonResponse({ received: true });
    }

    if (eventType === "transaction.completed") {
      // Backup path: some flows deliver the transaction before the
      // subscription event. Pull the subscription and apply it.
      const tx = event.data as PaddleTransaction;
      if (tx.subscription_id) {
        const { paddleRequest } = await import("@/lib/paddle.server");
        const { data: sub } = await paddleRequest<PaddleSubscription>(
          "GET",
          `/subscriptions/${encodeURIComponent(tx.subscription_id)}`,
        );
        if (sub) await applySubscription(supabaseAdmin, sub);
      }
      // Affiliate commission for this payment — a no-op when the buyer was
      // never referred or is past the 12-month commission window.
      await applyAffiliateCommission(supabaseAdmin, tx, event.occurred_at ?? null);
      return jsonResponse({ received: true });
    }

    if (eventType === "adjustment.updated") {
      // Refunds and chargebacks reverse any commission tied to the
      // transaction (no-op when already reversed or never created).
      const adj = event.data as PaddleAdjustment;
      if ((adj.action === "refund" || adj.action === "chargeback") && adj.transaction_id) {
        const { error } = await callRpc(supabaseAdmin, "reverse_affiliate_commissions", {
          p_transaction_id: adj.transaction_id,
        });
        if (error) throw new Error(error.message);
      }
      return jsonResponse({ received: true });
    }

    // Anything else (customer.*, adjustment.credit, ...) is acknowledged but
    // not acted on.
    return jsonResponse({ received: true });
  } catch (error) {
    console.error("paddle webhook handler failed", error instanceof Error ? error.message : error);
    return jsonResponse({ error: "Handler failed." }, 500);
  }
}
