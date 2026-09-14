import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// In-app view of the instant-alert channel (Advise tier). Rows are written
// by the daily alerts cron; this function only reads and acknowledges.

export type MarketAlertRow = {
  id: string;
  kind: string;
  alertKind: string;
  tone: "red" | "amber" | "green" | string;
  headline: string;
  detail: string | null;
  competitorName: string | null;
  businessId: string;
  businessName: string | null;
  acknowledgedAt: string | null;
  emailSentAt: string | null;
  createdAt: string;
};

const AckInput = z.object({
  id: z.string().min(1),
  acknowledge: z.boolean().default(true),
});

export const listMarketAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        businessId: z.string().uuid().optional(),
        unacknowledgedOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(50).default(10),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ alerts: MarketAlertRow[] }> => {
    let query = context.supabase
      .from("market_alerts")
      .select("id, kind, alert_kind, tone, headline, detail, competitor_name, business_id, acknowledged_at, email_sent_at, created_at, businesses ( business_name )")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.businessId) query = query.eq("business_id", data.businessId);
    if (data.unacknowledgedOnly) query = query.is("acknowledged_at", null);

    const { data: rows, error } = await query;
    if (error) {
      // The alerts table may not exist yet on pre-migration databases — the
      // strip is a nicety, so degrade to "no alerts" rather than erroring.
      if (/relation .* does not exist|schema cache/i.test(error.message)) return { alerts: [] };
      throw new Error(error.message);
    }

    return {
      alerts: (rows ?? []).map((row) => ({
        id: row.id,
        kind: row.kind,
        alertKind: row.alert_kind,
        tone: row.tone,
        headline: row.headline,
        detail: row.detail,
        competitorName: row.competitor_name,
        businessId: row.business_id,
        businessName:
          (row.businesses as { business_name: string } | null)?.business_name ?? null,
        acknowledgedAt: row.acknowledged_at,
        emailSentAt: row.email_sent_at,
        createdAt: row.created_at,
      })),
    };
  });

export const acknowledgeMarketAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(AckInput.parse)
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { error } = await context.supabase
      .from("market_alerts")
      .update({ acknowledged_at: data.acknowledge ? new Date().toISOString() : null })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
