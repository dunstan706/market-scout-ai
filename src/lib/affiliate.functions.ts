import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// In-house affiliate program server layer. Attribution is locked at signup:
// the first affiliate whose referral link a visitor ever arrived through
// owns that customer (first attribution wins, recorded in
// affiliate_referrals). Commissions themselves are written by the Paddle
// webhook (record_affiliate_commission RPC); everything here is the human
// side — applying, reviewing, and paying out.

export type AffiliateStatus = "pending" | "approved" | "suspended";

export type AffiliateProfile = {
  id: string;
  code: string;
  email: string;
  name: string | null;
  status: AffiliateStatus;
  payoutEmail: string | null;
  createdAt: string;
};

export type AffiliateCommissionRow = {
  id: string;
  referredUserId: string;
  amount: number;
  currencyCode: string;
  status: "pending" | "available" | "paid" | "reversed";
  paymentNumber: number;
  createdAt: string;
  payableAfter: string;
};

export type AffiliateReferralRow = {
  id: string;
  userId: string;
  email: string | null;
  converted: boolean;
  createdAt: string;
};

export type AffiliatePayoutRow = {
  id: string;
  amount: number;
  currencyCode: string;
  reference: string | null;
  paidAt: string;
};

export type AffiliateStats = {
  affiliate: AffiliateProfile | null;
  referralLink: string | null;
  totals: {
    earned: number; // everything ever approved (pending + available + paid)
    recent30: number; // commissions created in the trailing 30 days
    available: number; // matured, not yet paid
    pending: number; // inside the 30-day holding window
    paid: number;
  };
  // referred_user_id -> lifetime earned from that referral (non-reversed).
  referralEarnings: Record<string, number>;
  referralCount: number;
  convertedCount: number;
  commissions: AffiliateCommissionRow[];
  referrals: AffiliateReferralRow[];
  payouts: AffiliatePayoutRow[];
};

export type AdminAffiliateRow = AffiliateProfile & {
  userId: string | null;
  referralCount: number;
  convertedCount: number;
  earned: number;
  payable: number; // matured and unpaid
};

// Typed shapes for the raw query rows below — direct property access with the
// project's no-index-signature-dot-access rule.
type AffiliateDbRow = {
  id: string;
  user_id?: string | null;
  code: string;
  email: string;
  name?: string | null;
  status?: string;
  payout_email?: string | null;
  created_at?: string;
};
type CommissionDbRow = {
  id: string;
  referred_user_id?: string;
  amount: number;
  currency_code?: string;
  status: string;
  payment_number: number;
  created_at: string;
  payable_after: string;
};
type ReferralDbRow = {
  id: string;
  referred_user_id?: string;
  referred_email?: string | null;
  converted_at?: string | null;
  created_at: string;
};
type PayoutDbRow = {
  id: string;
  amount: number;
  currency_code?: string;
  reference?: string | null;
  paid_at: string;
};

function toAffiliateProfile(row: AffiliateDbRow): AffiliateProfile {
  return {
    id: row.id,
    code: row.code,
    email: row.email,
    name: row.name ?? null,
    status: (row.status ?? "pending") as AffiliateStatus,
    payoutEmail: row.payout_email ?? null,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

// auth.users isn't part of the generated public-schema types and isn't
// exposed to PostgREST — lookups go through the GoTrue admin API helper.
import { getAuthEmailById } from "@/integrations/supabase/auth-lookup.server";

// --- Application ---

const ApplyInput = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  payoutEmail: z.string().trim().email().max(160).optional(),
  promoMethod: z.string().trim().max(500).optional(),
});

function generateAffiliateCode(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 8);
  const suffix = randomBytes(3).toString("hex"); // 6 hex chars — collision-safe
  return `${base || "partner"}-${suffix}`;
}

export const applyForAffiliateProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ApplyInput.parse)
  .handler(async ({ data, context }): Promise<{ ok: true; affiliate: AffiliateProfile }> => {
    // One application per account.
    const { data: existing } = await context.supabase
      .from("affiliates")
      .select("id, code, email, name, status, payout_email, created_at")
      .eq("user_id", context.userId)
      .limit(1);
    const existingRow = (existing as AffiliateDbRow[] | null)?.[0];
    if (existingRow) {
      return { ok: true, affiliate: toAffiliateProfile(existingRow) };
    }

    const code = generateAffiliateCode(data.name);
    const { data: inserted, error } = await context.supabase
      .from("affiliates")
      .insert({
        user_id: context.userId,
        code,
        email: data.email.toLowerCase(),
        name: data.name,
        status: "pending",
        payout_email: data.payoutEmail?.toLowerCase() ?? null,
        payout_notes: data.promoMethod || null,
      })
      .select("id, code, email, name, status, payout_email, created_at")
      .single();
    if (error) throw new Error(error.message);

    return { ok: true, affiliate: toAffiliateProfile(inserted as unknown as AffiliateDbRow) };
  });

// --- Referral claim (called from signup / first login) ---

const ClaimReferralInput = z.object({
  code: z.string().trim().min(2).max(42).regex(/^[a-z0-9][a-z0-9-]{1,40}$/i),
  sourceUrl: z.string().max(300).optional(),
});

export const claimReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ClaimReferralInput.parse)
  .handler(async ({ data, context }): Promise<{ claimed: boolean }> => {
    // Already attributed — first attribution wins, never overwrite.
    const { data: existing } = await supabaseAdmin
      .from("affiliate_referrals")
      .select("id")
      .eq("referred_user_id", context.userId)
      .limit(1);
    if ((existing as Array<{ id: string }> | null)?.length) return { claimed: false };

    const { data: affiliate } = await supabaseAdmin
      .from("affiliates")
      .select("id, email, user_id, status")
      .eq("code", data.code.toLowerCase())
      .limit(1);
    const affiliateRow = (affiliate as Array<{ id: string; email: string; user_id: string | null }> | null)?.[0];
    if (!affiliateRow) return { claimed: false };

    // Self-referral ban, enforced server-side: you cannot attribute yourself
    // (same account) or your own email.
    if (affiliateRow.user_id && affiliateRow.user_id === context.userId) return { claimed: false };
    const userEmail = (await getAuthEmailById(context.userId)) ?? "";
    if (userEmail && userEmail === affiliateRow.email.toLowerCase()) {
      return { claimed: false };
    }
  
    const { error } = await supabaseAdmin.from("affiliate_referrals").insert({
      affiliate_id: affiliateRow.id,
      referred_user_id: context.userId,
      referred_email: userEmail || null,
      source_url: data.sourceUrl ?? null,
    });
    // Unique constraint = raced claim (double submit) — fine, first wins.
    if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
    return { claimed: true };
  });

// --- Affiliate dashboard data ---

function siteOrigin(): string {
  return (process.env["SITE_ORIGIN"] ?? "https://thebizscope.com").replace(/\/$/, "");
}

export const getMyAffiliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AffiliateStats> => {
    const { data: affiliateRows } = await context.supabase
      .from("affiliates")
      .select("id, code, email, name, status, payout_email, created_at")
      .eq("user_id", context.userId)
      .limit(1);
    const a = (affiliateRows as AffiliateDbRow[] | null)?.[0];
    if (!a) {
      return {
        affiliate: null,
        referralLink: null,
        totals: { earned: 0, recent30: 0, available: 0, pending: 0, paid: 0 },
        referralEarnings: {},
        referralCount: 0,
        convertedCount: 0,
        commissions: [],
        referrals: [],
        payouts: [],
      };
    }
    const affiliateId = a.id;

    const [commissionsRes, referralsRes, payoutsRes] = await Promise.all([
      context.supabase
        .from("affiliate_commissions")
        .select("id, referred_user_id, amount, currency_code, status, payment_number, created_at, payable_after")
        .eq("affiliate_id", affiliateId)
        .order("created_at", { ascending: false })
        .limit(100),
      context.supabase
        .from("affiliate_referrals")
        .select("id, referred_user_id, referred_email, converted_at, created_at")
        .eq("affiliate_id", affiliateId)
        .order("created_at", { ascending: false })
        .limit(200),
      context.supabase
        .from("affiliate_payouts")
        .select("id, amount, currency_code, reference, paid_at")
        .eq("affiliate_id", affiliateId)
        .order("paid_at", { ascending: false })
        .limit(50),
    ]);

    const commissions = ((commissionsRes.data ?? []) as CommissionDbRow[]).map((c) => ({
      id: c.id,
      referredUserId: c.referred_user_id ?? "",
      amount: Number(c.amount),
      currencyCode: c.currency_code ?? "USD",
      status: c.status as AffiliateCommissionRow["status"],
      paymentNumber: Number(c.payment_number),
      createdAt: c.created_at,
      payableAfter: c.payable_after,
    }));
    const referrals = ((referralsRes.data ?? []) as ReferralDbRow[]).map((r) => ({
      id: r.id,
      userId: r.referred_user_id ?? "",
      email: r.referred_email ?? null,
      converted: Boolean(r.converted_at),
      createdAt: r.created_at,
    }));
    const payouts = ((payoutsRes.data ?? []) as PayoutDbRow[]).map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      currencyCode: p.currency_code ?? "USD",
      reference: p.reference ?? null,
      paidAt: p.paid_at,
    }));

    const sum = (rows: Array<AffiliateCommissionRow | AffiliatePayoutRow>) =>
      rows.reduce((acc, c) => acc + c.amount, 0);
    const now = Date.now();
    const activeCommissions = commissions.filter((c) => c.status !== "reversed");
    const referralEarnings: Record<string, number> = {};
    for (const c of activeCommissions) {
      referralEarnings[c.referredUserId] = (referralEarnings[c.referredUserId] ?? 0) + c.amount;
    }
    return {
      affiliate: {
        id: a.id,
        code: a.code,
        email: a.email,
        name: a.name ?? null,
        status: (a.status ?? "pending") as AffiliateStatus,
        payoutEmail: a.payout_email ?? null,
        createdAt: a.created_at ?? new Date().toISOString(),
      },
      referralLink: `${siteOrigin()}/?ref=${a.code}`,
      totals: {
        earned: sum(activeCommissions),
        recent30: sum(
          activeCommissions.filter((c) => Date.parse(c.createdAt) >= now - 30 * 24 * 60 * 60 * 1000),
        ),
        available: sum(commissions.filter((c) => c.status === "available" && Date.parse(c.payableAfter) <= now)),
        pending: sum(commissions.filter((c) => c.status === "pending" || Date.parse(c.payableAfter) > now)),
        paid: sum(payouts),
      },
      referralEarnings,
      referralCount: referrals.length,
      convertedCount: referrals.filter((r) => r.converted).length,
      commissions,
      referrals,
      payouts,
    };
  });

// --- Admin (site owner) operations ---
// Admins are designated by ADMIN_EMAILS (comma-separated) in the
// environment; the caller's email is resolved server-side from their
// session — never trusted from the client.

async function assertAdmin(userId: string): Promise<void> {
  const adminEmails = (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length === 0) throw new Error("Admin access is not configured.");
  const email = await getAuthEmailById(userId);
  if (!email || !adminEmails.includes(email)) throw new Error("Admin access required.");
}

const AdminActionInput = z.object({ affiliateId: z.string().uuid() });
const PayoutInput = z.object({
  affiliateId: z.string().uuid(),
  reference: z.string().trim().max(120).optional(),
});

export const listAffiliateApplications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ isAdmin: boolean; rows: AdminAffiliateRow[] }> => {
    await assertAdmin(context.userId);

    const { data: affiliates } = await supabaseAdmin
      .from("affiliates")
      .select("id, user_id, code, email, name, status, payout_email, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    const rows = (affiliates ?? []) as AffiliateDbRow[];

    const enriched = await Promise.all(
      rows.map(async (a) => {
        const affiliateId = a.id;
        const [{ data: referrals }, { data: commissions }] = await Promise.all([
          supabaseAdmin.from("affiliate_referrals").select("id, converted_at").eq("affiliate_id", affiliateId),
          supabaseAdmin
            .from("affiliate_commissions")
            .select("amount, status, payable_after")
            .eq("affiliate_id", affiliateId),
        ]);
        const referralRows = (referrals ?? []) as Array<{ converted_at: string | null }>;
        const commissionRows = (commissions ?? []) as Array<{ amount: number; status: string; payable_after: string }>;
        const now = Date.now();
        const payable = commissionRows
          .filter(
            (c) =>
              c.status === "available" &&
              Date.parse(c.payable_after) <= now,
          )
          .reduce((acc, c) => acc + Number(c.amount), 0);
        const earned = commissionRows
          .filter((c) => c.status !== "reversed")
          .reduce((acc, c) => acc + Number(c.amount), 0);
        return {
          id: a.id,
          userId: a.user_id ?? null,
          code: a.code,
          email: a.email,
          name: a.name ?? null,
          status: (a.status ?? "pending") as AffiliateStatus,
          payoutEmail: a.payout_email ?? null,
          createdAt: a.created_at ?? new Date().toISOString(),
          referralCount: referralRows.length,
          convertedCount: referralRows.filter((r) => r.converted_at).length,
          earned,
          payable,
        } satisfies AdminAffiliateRow;
      }),
    );
    return { isAdmin: true, rows: enriched };
  });

export const setAffiliateStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z
      .object({ affiliateId: z.string().uuid(), status: z.enum(["pending", "approved", "suspended"]) })
      .parse,
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("affiliates")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.affiliateId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Records a payout: inserts the payout row and flips the affiliate's matured
// available commissions to `paid` under it. The amount is computed
// server-side from the commissions themselves, so the ledger can never drift
// from what was actually marked paid.
export const recordAffiliatePayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(PayoutInput.parse)
  .handler(
    async ({ data, context }): Promise<{ ok: boolean; amount: number; commissionCount: number }> => {
      await assertAdmin(context.userId);
      const nowIso = new Date().toISOString();

      const { data: due, error: dueError } = await supabaseAdmin
        .from("affiliate_commissions")
        .select("id, amount")
        .eq("affiliate_id", data.affiliateId)
        .eq("status", "available")
        .lte("payable_after", nowIso);
      if (dueError) throw new Error(dueError.message);
      const dueRows = (due ?? []) as Array<{ id: string; amount: number }>;
      if (dueRows.length === 0) throw new Error("Nothing is payable yet for this affiliate.");

      const amount = Number(dueRows.reduce((acc, c) => acc + Number(c.amount), 0).toFixed(2));
      const { data: payout, error: payoutError } = await supabaseAdmin
        .from("affiliate_payouts")
        .insert({ affiliate_id: data.affiliateId, amount, reference: data.reference ?? null })
        .select("id")
        .single();
      if (payoutError) throw new Error(payoutError.message);
      const payoutId = String((payout as unknown as { id: string }).id);

      const { error: markError } = await supabaseAdmin
        .from("affiliate_commissions")
        .update({ status: "paid", payout_id: payoutId, updated_at: nowIso })
        .in(
          "id",
          dueRows.map((c) => c.id),
        );      if (markError) throw new Error(markError.message);
      return { ok: true, amount, commissionCount: dueRows.length };
    },
  );
