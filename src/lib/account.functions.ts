import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Tables } from "@/integrations/supabase/types";
import { BriefSchema } from "@/lib/brief-core";
import { collectLocalResearch, type ResearchSnapshot } from "@/lib/local-research.server";
import { describeBriefError, writeBrief } from "@/lib/brief-writer.server";
import type { LocalizedPrice } from "@/lib/paddle.server";
import {
  detectChanges,
  parseDetectedChanges,
  parseResearchSnapshot,
  type DetectedChange,
  type ResearchSnapshot as StoredResearchSnapshot,
} from "@/lib/change-detection";
import { buildMarketAnalysis, type MarketAnalysis } from "@/lib/market-analysis";
import type { Brief } from "@/lib/brief.functions";

// All handlers here are wrapped in requireSupabaseAuth, which validates the
// bearer token attached by attachSupabaseAuth and provides a user-scoped
// Supabase client (RLS applies) plus the user id.

export const BusinessTypeSchema = z.enum(["salon", "spa", "other"]);
export type BusinessType = z.infer<typeof BusinessTypeSchema>;

export type Profile = {
  businessName: string;
  businessType: BusinessType;
  location: string;
  // Optional "your typical price" (raw text, e.g. "$45") — anchors the
  // price-position analysis. Blank means no price position is reported.
  pricePoint?: string;
};

const ProfileInput = z.object({
  businessName: z.string().trim().min(2).max(120),
  businessType: BusinessTypeSchema,
  location: z.string().trim().min(2).max(160),
  pricePoint: z.string().trim().max(40).optional(),
});

// Shape of a generated brief as stored in the briefs table (jsonb).
export const StoredBriefSchema = BriefSchema.extend({
  sources: z.array(
    z.object({ label: z.string(), url: z.string(), kind: z.enum(["directory", "website", "reviews"]) }),
  ),
  warnings: z.array(z.string()),
  capturedAt: z.string(),
});
export type StoredBrief = z.infer<typeof StoredBriefSchema>;

export type BriefRecord = {
  id: string;
  businessName: string;
  businessType: BusinessType;
  location: string;
  brief: StoredBrief;
  createdAt: string;
};

export type MonitoringStatus = {
  lastRunAt: string | null;
  baseline: boolean;
  snapshotCount: number;
  changes: DetectedChange[];
  analysis: MarketAnalysis | null;
};

type ProfileRow = Tables<"profiles">;

// In development, append the underlying Supabase error so setup problems
// (missing tables from unapplied migrations, RLS mistakes) are visible in the
// UI instead of hidden behind a generic message. Production stays generic.
function describeError(message: string, detail: string | undefined): string {
  if (process.env["NODE_ENV"] === "production" || !detail) return message;
  return `${message} ${detail}`;
}

function normalizePricePoint(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.slice(0, 40) : null;
}

type ProfileWriteRow = {
  id: string;
  business_name: string;
  business_type: string;
  location: string;
  price_point?: string | null;
  updated_at: string;
};

// The optional price_point column ships in a later migration. Until it is
// applied, saves that include it would fail with an unknown-column error — so
// the first such failure is detected and downgraded to a save without the
// column (cached per process), keeping profile saves working everywhere.
let pricePointSupported: boolean | null = null;

function isMissingPricePointError(error: { code?: string; message?: string }): boolean {
  if (error.code === "42703") return true;
  return (
    typeof error.message === "string" &&
    /price_point/i.test(error.message) &&
    /column|does not exist|42703/i.test(error.message)
  );
}

function toProfile(row: ProfileRow | null): Profile | null {
  if (!row) return null;
  const businessType: BusinessType =
    row.business_type === "spa" || row.business_type === "other" ? row.business_type : "salon";
  return {
    businessName: row.business_name ?? "",
    businessType,
    location: row.location ?? "",
    pricePoint: row.price_point ?? "",
  };
}

function toBusinessType(value: string): BusinessType {
  return value === "spa" || value === "other" ? value : "salon";
}

export const getMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ profile: Profile | null }> => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) console.error("getMyProfile failed", error);
    return { profile: toProfile(data) };
  });

// Business-facing view of an account's business (one per account while the
// free tier caps at 1; the multi-business data model ships later).
export type Business = {
  id: string;
  businessName: string;
  businessType: BusinessType;
  location: string;
  pricePoint?: string;
};

function toBusiness(row: ProfileRow): Business {
  const businessType: BusinessType =
    row.business_type === "spa" || row.business_type === "other" ? row.business_type : "salon";
  return {
    id: row.id,
    businessName: row.business_name ?? "",
    businessType,
    location: row.location ?? "",
    pricePoint: row.price_point ?? "",
  };
}

export const listBusinesses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ businesses: Business[] }> => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) console.error("listBusinesses failed", error);
    return { businesses: data ? [toBusiness(data)] : [] };
  });

// Adds the account's first (and, on the free tier, only) business. The
// soft-cap is enforced here server-side so the UI limit can't be bypassed.
export const createBusiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ProfileInput.parse(input))
  .handler(async ({ data, context }): Promise<{ business: Business }> => {
    const { data: existing } = await context.supabase
      .from("profiles")
      .select("id")
      .eq("id", context.userId)
      .maybeSingle();
    if (existing) {
      throw new Error(
        describeError(
          "Your plan includes one business.",
          "Free accounts monitor a single business — paid plans (coming soon) add more.",
        ),
      );
    }
    const base: ProfileWriteRow = {
      id: context.userId,
      business_name: data.businessName,
      business_type: data.businessType,
      location: data.location,
      updated_at: new Date().toISOString(),
    };
    const payload = (withPricePoint: boolean): ProfileWriteRow =>
      withPricePoint ? { ...base, price_point: normalizePricePoint(data.pricePoint) } : base;
    const upsertWith = async (withPricePoint: boolean) => {
      const result = await context.supabase
        .from("profiles")
        .upsert(payload(withPricePoint), { onConflict: "id" });
      return result.error;
    };
    let error = await upsertWith(pricePointSupported !== false);
    if (error && isMissingPricePointError(error)) {
      pricePointSupported = false;
      error = await upsertWith(false);
    }
    if (error) {
      console.error("createBusiness failed", error);
      throw new Error(describeError("Could not add your business.", error.message));
    }
    const { data: created } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    if (!created) {
      throw new Error(describeError("Could not add your business.", "Profile was not created."));
    }
    return { business: toBusiness(created) };
  });

// Probes whether the tables the dashboard writes to exist (they're created by
// the setup migrations, not by the app). Runs through the user's scoped client
// so it mirrors exactly what saveProfile / generateMonitoringBrief will hit.
// A missing table is reported up front so the dashboard can show a setup
// screen instead of letting every action fail with a generic error.
export const getSchemaStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ ok: boolean; missingTables: Array<"profiles" | "monitoring_snapshots"> }> => {
      const probe = async (table: "profiles" | "monitoring_snapshots") => {
        const { error } = await context.supabase.from(table).select("id").limit(1);
        if (!error) return true;
        // PGRST205 = "Could not find the table '...' in the schema cache"
        // (PostgREST's missing-table error). Any other failure (network
        // hiccup, RLS) leaves the dashboard running — those errors surface
        // where they actually happen.
        return !(error.code === "PGRST205" || /could not find the table/i.test(error.message));
      };
      const [profiles, monitoringSnapshots] = await Promise.all([
        probe("profiles"),
        probe("monitoring_snapshots"),
      ]);
      const missingTables: Array<"profiles" | "monitoring_snapshots"> = [];
      if (!profiles) missingTables.push("profiles");
      if (!monitoringSnapshots) missingTables.push("monitoring_snapshots");
      return { ok: missingTables.length === 0, missingTables };
    },
  );

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ProfileInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const base: ProfileWriteRow = {
      id: context.userId,
      business_name: data.businessName,
      business_type: data.businessType,
      location: data.location,
      updated_at: new Date().toISOString(),
    };
    const payload = (withPricePoint: boolean): ProfileWriteRow =>
      withPricePoint ? { ...base, price_point: normalizePricePoint(data.pricePoint) } : base;
    const upsertWith = async (withPricePoint: boolean) => {
      const result = await context.supabase
        .from("profiles")
        .upsert(payload(withPricePoint), { onConflict: "id" });
      return result.error;
    };
    let error = await upsertWith(pricePointSupported !== false);
    if (error && isMissingPricePointError(error)) {
      pricePointSupported = false;
      error = await upsertWith(false);
    }
    if (error) {
      console.error("saveProfile failed", error);
      throw new Error(describeError("Could not save your profile.", error.message));
    }
    return { ok: true };
  });

// When a signed-in user has no profile yet but signed up for the waitlist with
// the same email, link the waitlist row and prefill their profile from it
// (business name / type / city) so the dashboard starts populated.
export const claimWaitlistProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ profile: Profile | null; claimed: boolean }> => {
      const userId = context.userId;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: existing } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (existing) return { profile: toProfile(existing), claimed: false };

      const { data: authData } = await supabaseAdmin.auth.admin.getUserById(userId);
      const email = authData?.user?.email?.toLowerCase();
      if (!email) return { profile: null, claimed: false };

      const { data: signup } = await supabaseAdmin
        .from("waitlist_signups")
        .select("*")
        .eq("email", email)
        .is("user_id", null)
        .maybeSingle();
      if (!signup) return { profile: null, claimed: false };

      const { error } = await supabaseAdmin.from("profiles").upsert(
        {
          id: userId,
          business_name: signup.business_name,
          business_type:
            signup.business_type === "spa" || signup.business_type === "other"
              ? signup.business_type
              : "salon",
          location: signup.city,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (error) {
        console.error("claimWaitlistProfile upsert failed", error);
        return { profile: null, claimed: false };
      }

      await supabaseAdmin.from("waitlist_signups").update({ user_id: userId }).eq("id", signup.id);

      const { data: created } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      return { profile: toProfile(created), claimed: true };
    },
  );

// Runs one full monitoring cycle for the signed-in user's profile:
// 1. fresh research scan, 2. diff vs the latest stored snapshot,
// 3. store the new snapshot with detected changes, 4. write + store the brief.
export const generateMonitoringBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<
      | {
          ok: true;
          brief: Brief;
          changes: DetectedChange[];
          monitoredAt: string;
          baseline: boolean;
          analysis: MarketAnalysis;
        }
      | { ok: false; error: string }
    > => {
      const userId = context.userId;

      // Per-user rate limit on scans: each one spends real money (Google
      // Places, secondary sources, website fetches, an LLM call). The public
      // form is capped by IP; authenticated scans are capped by account.
      const { checkRateLimit } = await import("@/lib/rate-limit.server");
      const scanLimit = checkRateLimit(`scan:${userId}`, 10, 60 * 60 * 1000);
      if (!scanLimit.allowed) {
        return {
          ok: false,
          error: `You've run a lot of scans this hour — try again in about ${Math.ceil(scanLimit.retryAfterSeconds / 60)} minutes.`,
        };
      }

      const { data: profileRow } = await context.supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      const profile = toProfile(profileRow);
      if (!profile?.businessName || !profile.location) {
        return { ok: false, error: "Save your business name and neighbourhood first." };
      }
      const input = {
        businessName: profile.businessName,
        businessType: profile.businessType,
        location: profile.location,
        // Pin from a previous successful match, when present: the own-listing
        // lookup targets the place ID directly instead of re-matching names.
        googlePlaceId: profileRow?.google_place_id ?? undefined,
      };

      let research: ResearchSnapshot;
      try {
        research = await collectLocalResearch(input);
      } catch (error) {
        console.error("monitoring research failed", error);
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "We couldn't reach the public research sources. Please try again.",
        };
      }

      // Recent stored history drives both change detection (previous run) and
      // the trend analysis (the whole window). Newest first, then reversed.
      const { data: historyRows } = await context.supabase
        .from("monitoring_snapshots")
        .select("snapshot")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(8);
      const historyAsc: StoredResearchSnapshot[] = [];
      for (const row of [...(historyRows ?? [])].reverse()) {
        const parsed = parseResearchSnapshot(row.snapshot);
        if (parsed) historyAsc.push(parsed);
      }
      const previous = historyAsc[historyAsc.length - 1] ?? null;
      const changes = detectChanges(previous, research);

      // Same treatment as the weekly cron: the market analysis (rating rank,
      // price position, benchmarks) is computed from stored history and fed
      // into the brief writer so dashboard briefs are as deep as the mail.
      const analysis = buildMarketAnalysis(research, historyAsc, profile.pricePoint ?? null);

      // Persist the snapshot BEFORE the LLM call: a failed/aborted brief
      // generation must not discard the scan — the research was already paid
      // for, and the next run should diff against this scan, not stale data.
      const { error: snapshotError } = await context.supabase
        .from("monitoring_snapshots")
        .insert({
          user_id: userId,
          business_name: input.businessName,
          business_type: input.businessType,
          location: input.location,
          snapshot: research as unknown as Json,
          detected_changes: changes as unknown as Json,
        });
      if (snapshotError) console.error("monitoring snapshot insert failed", snapshotError);

      // Pin the matched listing on the profile: from here on, own-listing
      // lookups key on the place ID and stop depending on the typed name
      // (immune to typos, rebrands, and word-order differences).
      const matchedPlaceId = research.ownListingPlaceId ?? undefined;
      if (matchedPlaceId && matchedPlaceId !== input.googlePlaceId) {
        const { error: pinError } = await context.supabase
          .from("profiles")
          .update({ google_place_id: matchedPlaceId })
          .eq("id", userId);
        if (pinError) {
          console.error("google place id persist failed", pinError.message);
        } else if (profileRow) {
          profileRow.google_place_id = matchedPlaceId;
        }
      }

      let generated;
      try {
        generated = await writeBrief({ input, research, changes, analysis });
      } catch (error) {
        console.error("monitoring brief failed", error);
        return { ok: false, error: describeBriefError(error) };
      }

      const brief = {
        ...generated,
        sources: research.sources,
        warnings: research.warnings,
        capturedAt: research.capturedAt,
      };
      const { error: briefError } = await context.supabase.from("briefs").insert({
        user_id: userId,
        business_name: input.businessName,
        business_type: input.businessType,
        location: input.location,
        brief: brief as unknown as Json,
      });
      if (briefError) {
        console.error("monitoring brief insert failed", briefError);
        return { ok: false, error: describeError("Could not save your brief.", briefError.message) };
      }

      return {
        ok: true,
        brief,
        changes,
        monitoredAt: research.capturedAt,
        baseline: previous === null,
        analysis,
      };
    },
  );

export const getMonitoringStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ status: MonitoringStatus }> => {
    const userId = context.userId;
    const { data: profileRow } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    const profile = toProfile(profileRow);
    const { data: rows } = await context.supabase
      .from("monitoring_snapshots")
      .select("snapshot, detected_changes, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8);
    const ordered = [...(rows ?? [])].reverse(); // oldest first
    const snapshotsAsc: StoredResearchSnapshot[] = [];
    for (const row of ordered) {
      const parsed = parseResearchSnapshot(row.snapshot);
      if (parsed) snapshotsAsc.push(parsed);
    }
    const { count } = await context.supabase
      .from("monitoring_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    const latestRow = ordered[ordered.length - 1] ?? null;
    const latest = snapshotsAsc[snapshotsAsc.length - 1] ?? null;
    return {
      status: {
        lastRunAt: latestRow?.created_at ?? null,
        baseline: latest === null,
        snapshotCount: count ?? 0,
        changes: latestRow ? parseDetectedChanges(latestRow.detected_changes) : [],
        analysis: latest
          ? buildMarketAnalysis(latest, snapshotsAsc.slice(0, -1), profile?.pricePoint ?? null)
          : null,
      },
    };
  });

// Sends the signed-in user a sample of the weekly brief email — the fastest
// way to verify Resend delivery (key, verified sender, spam filters) without
// waiting for the real cron run or spending a research cycle. Renders the
// exact email template with a fixed example brief, addressed to their account.
export const sendTestBriefEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ ok: boolean; error?: string }> => {
      const userId = context.userId;
      const { data: profileRow } = await context.supabase
        .from("profiles")
        .select("business_name, location")
        .eq("id", userId)
        .maybeSingle();
      // The auth-scoped client has no persisted session, so the account email
      // comes from an admin lookup (same pattern as the cron / waitlist claim).
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: authRow } = await supabaseAdmin.auth.admin.getUserById(userId);
      const email = authRow?.user?.email;
      if (!email) {
        return { ok: false, error: "No email address found on your account." };
      }
      const businessName = (profileRow?.business_name as string | null) ?? "Your business";
      const location = (profileRow?.location as string | null) ?? "your neighbourhood";

      // Dynamic import keeps the email + Resend code out of the client bundle.
      const { renderBriefEmail, sendEmail } = await import("@/lib/email.server");
      const { subject, html, text } = renderBriefEmail({
        title: `${businessName}, ${location}`,
        signals: [
          {
            tone: "amber",
            label: "Sample signal",
            headline: "A competitor nearby changed a price",
            detail: "This is what a real signal will look like in your weekly brief.",
          },
          {
            tone: "green",
            label: "Sample signal",
            headline: "A new positive review mentions your service",
            detail: "Real reviews, ratings and sentiment summaries appear here.",
          },
          {
            tone: "red",
            label: "Sample signal",
            headline: "Something needs your attention",
            detail: "Important moves are ranked and explained in plain language.",
          },
        ],
        recommendation: "This is a test email — your real weekly brief will arrive every Monday morning.",
        why: "The email below uses the exact template theBizScope sends for real briefs.",
        sources: [{ label: "theBizScope test", url: "https://thebizscope.com" }],
        dashboardUrl: "https://thebizscope.com/dashboard",
      });
      const sent = await sendEmail({ to: email, subject, html, text });
      if (!sent.ok) return { ok: false, error: sent.error };
      return { ok: true };
    },
  );

export const listBriefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ briefs: BriefRecord[] }> => {
    const { data, error } = await context.supabase
      .from("briefs")
      .select("id, business_name, business_type, location, brief, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) {
      console.error("listBriefs failed", error);
      return { briefs: [] };
    }
    const briefs: BriefRecord[] = [];
    for (const row of data ?? []) {
      const parsed = StoredBriefSchema.safeParse(row.brief);
      if (!parsed.success) continue;
      briefs.push({
        id: row.id,
        businessName: row.business_name,
        businessType: toBusinessType(row.business_type),
        location: row.location,
        brief: parsed.data,
        createdAt: row.created_at,
      });
    }
    return { briefs };
  });

// --- Billing (Paddle) ---

export type BillingStatus = {
  paddleConnected: boolean;
  planTier: "free" | "watch" | "advise";
  /** Whether the subscription currently grants paid access — false for
   *  canceled/paused even when the mapped tier is still populated. */
  accessGranted: boolean;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cadence: "monthly" | "yearly" | null;
};

// The signed-in user's plan + subscription state, straight from the profile
// row that Paddle webhooks keep in sync. `paddleConnected` lets the UI decide
// whether plan buttons start checkout or explain that billing is not set up.
export const getBillingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ status: BillingStatus }> => {
    const { data } = await context.supabase
      .from("profiles")
      .select("plan_tier, subscription_status, current_period_end, billing_cadence")
      .eq("id", context.userId)
      .maybeSingle();

    const row = (data ?? {}) as {
      plan_tier?: string | null;
      subscription_status?: string | null;
      current_period_end?: string | null;
      billing_cadence?: string | null;
    };
    const { subscriptionGrantsAccess } = await import("@/lib/paddle.server");
    const planTier =
      row.plan_tier === "watch" || row.plan_tier === "advise" ? row.plan_tier : "free";

    return {
      status: {
        paddleConnected: Boolean(process.env["PADDLE_API_KEY"]),
        planTier,
        accessGranted: planTier === "free" ? false : subscriptionGrantsAccess(row.subscription_status),
        subscriptionStatus: row.subscription_status ?? null,
        currentPeriodEnd: row.current_period_end ?? null,
        cadence:
          row.billing_cadence === "yearly" ? "yearly" : row.billing_cadence === "monthly" ? "monthly" : null,
      },
    };
  });

// Generates a short-lived link to Paddle's hosted customer portal where the
// customer can manage payment methods, download invoices, and cancel. The
// customer id always resolves server-side from the profile — never from the
// client.
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
      const { data } = await context.supabase
        .from("profiles")
        .select("paddle_customer_id")
        .eq("id", context.userId)
        .maybeSingle();
      const customerId = (data as { paddle_customer_id?: string | null } | null)?.paddle_customer_id;
      if (!customerId) {
        return { ok: false, error: "No billing profile yet — subscribe to a plan first." };
      }

      const { createPaddlePortalSession } = await import("@/lib/paddle.server");
      return createPaddlePortalSession({ paddleCustomerId: customerId });
    },
  );

// --- Pricing page (Paddle.js + localized prices) ---

// Public Paddle.js config for the pricing page's checkout overlay. Safe to
// expose: the client token is designed for browser use, and price IDs are
// public catalog identifiers.
export const getPaddleEnv = createServerFn({ method: "POST" })
  .handler(
    async (): Promise<{
      clientToken: string | null;
      environment: "sandbox" | "live";
      priceIds: {
        watchMonthly: string | null;
        watchYearly: string | null;
        adviseMonthly: string | null;
        adviseYearly: string | null;
      };
    }> => {
      const { paddleClientToken, paddleApiBase, catalogPriceId } = await import("@/lib/paddle.server");
      return {
        clientToken: paddleClientToken() ?? null,
        environment: paddleApiBase() === "https://api.paddle.com" ? "live" : "sandbox",
        priceIds: {
          watchMonthly: catalogPriceId("watch", "monthly") ?? null,
          watchYearly: catalogPriceId("watch", "yearly") ?? null,
          adviseMonthly: catalogPriceId("advise", "monthly") ?? null,
          adviseYearly: catalogPriceId("advise", "yearly") ?? null,
        },
      };
    },
  );

// Country-localized, tax-inclusive prices for the pricing page, resolved from
// the visitor's IP so the displayed price matches what checkout will charge.
export const previewLocalizedPricing = createServerFn({ method: "POST" })
  .validator((input: { cadence?: "monthly" | "yearly" } | undefined) => ({
    cadence: input?.cadence ?? ("monthly" as const),
  }))
  .handler(
    async ({
      data,
    }: {
      data: { cadence: "monthly" | "yearly" };
    }): Promise<{
      prices: LocalizedPrice[];
      country: string | null;
      error?: string | undefined;
    }> => {
      const { previewLocalizedPricing: preview, paddleApiKey } = await import("@/lib/paddle.server");
      if (!paddleApiKey()) {
        return { prices: [], country: null, error: "Billing is not set up yet." };
      }

      // Paddle geo-resolves the visitor's IP when no explicit country is
      // given; local dev (no proxy headers) falls back to US.
      const { getRequest } = await import("@tanstack/react-start/server");
      const { clientIpFromRequest } = await import("@/lib/rate-limit.server");
      const ip = clientIpFromRequest(getRequest());

      const { prices, countryError } = await preview({
        countryCode: null,
        customerIp: ip,
        cadence: data?.cadence ?? "monthly",
      });
      return { prices, country: null, error: countryError };
    },
  );
