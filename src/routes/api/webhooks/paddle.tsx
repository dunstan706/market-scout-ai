import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/webhooks/paddle")({
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
};

type ProfileBillingRow = {
  id: string;
  paddle_customer_id?: string | null;
  paddle_subscription_id?: string | null;
  plan_tier?: string | null;
};

type PaddleCustomer = {
  id?: string;
  email?: string;
  name?: string;
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

// Locates the profile a subscription belongs to: the user id rides through
// checkout custom_data; afterwards the stored customer id (or the account
// email, as a last resort) keeps existing customers attached even when
// custom_data is absent (e.g. resubscribing via Paddle's hosted pages).
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
  if (customUserId) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, paddle_customer_id, paddle_subscription_id, plan_tier")
      .eq("id", customUserId)
      .limit(1);
    const row = (data as ProfileBillingRow[] | null)?.[0];
    if (row) return row;
  }

  if (customerId) {
    // Last resort: fetch the customer's email from Paddle and match profiles.
    const { paddleRequest } = await import("@/lib/paddle.server");
    const { data: customer } = await paddleRequest<{ email?: string }>(
      "GET",
      `/customers/${encodeURIComponent(customerId)}`,
    );
    const email = customer?.email;
    if (email) {
      const { data: authUsers } = await supabaseAdmin.from("users").select("id").eq("email", email).limit(1);
      const userId = (authUsers as Array<{ id: string }> | null)?.[0]?.id;
      if (userId) {        const { data } = await supabaseAdmin
          .from("profiles")
          .select("id, paddle_customer_id, paddle_subscription_id, plan_tier")
          .eq("id", userId)
          .limit(1);
      return (data as ProfileBillingRow[] | null)?.[0] ?? null;
      }
    }
  }
  return null;
}

// Attaches a Paddle customer to the matching profile (matched by email via
// auth.users). customer.created fires before checkout completes, so by the
// time the subscription event arrives the profile already carries the
// customer id. Idempotent: re-running the same event is a no-op.
async function applyCustomer(
  supabaseAdmin: { from: (table: string) => any },
  customer: PaddleCustomer,
): Promise<void> {
  if (!customer.id || !customer.email) return;

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("paddle_customer_id", customer.id)
    .limit(1);
  if ((existing as Array<{ id: string }> | null)?.length) return; // already attached

  const { data: authUsers } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", customer.email)
    .limit(1);
  const userId = (authUsers as Array<{ id: string }> | null)?.[0]?.id;
  if (!userId) return; // no account with that email yet — subscription events will attach it

  await supabaseAdmin.from("profiles").update({ paddle_customer_id: customer.id }).eq("id", userId);
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

async function handlePaddleWebhook(request: Request): Promise<Response> {
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

    if (eventType === "customer.created" || eventType === "customer.updated") {
      // Attached customers let the portal resolve server-side from the
      // profile — no customer id ever comes from the client.
      await applyCustomer(supabaseAdmin, event.data as PaddleCustomer);
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
      return jsonResponse({ received: true });
    }

    // Anything else (adjustment.*, customer.*, ...) is acknowledged but not
    // acted on.
    return jsonResponse({ received: true });
  } catch (error) {
    console.error("paddle webhook handler failed", error instanceof Error ? error.message : error);
    return jsonResponse({ error: "Handler failed." }, 500);
  }
}
