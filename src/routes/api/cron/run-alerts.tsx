import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/cron/run-alerts")({
  // API-only route — never rendered as a page.
  component: () => null,
  server: {
    handlers: {
      POST: async ({ request }) => runDailyAlerts(request),
    },
  },
});

type RunResult = {
  ok: boolean;
  scanned?: number;
  alerted?: number;
  emailed?: number;
  cooledDown?: number;
  overflowFolded?: number;
  skippedUnpaid?: number;
  failed?: Array<{ businessId: string | null; error: string }>;
  error?: string;
};

function jsonResponse(payload: RunResult, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Daily instant-alert sweep for the Advise tier.
//
// Runs the same research → snapshot → diff pipeline as the weekly cron, but
// lighter (secondary sources in "preview" mode — the deep multi-source pull
// is the weekly mail's job) and judges each detected change through
// classifyAlert(). Only red/amber "big moves" become alerts; everything else
// stays in Monday's weekly brief, untouched by this run.
//
// Noise controls:
// - 7-day cooldown per (business, kind, competitor) — repeats fold into the
//   weekly brief instead of re-emailing.
// - 1 alert email per user per day — further alerts are stored, shown
//   in-app, and summarized in Monday's mail.
// - No baseline yet (first scan of a business) → detectChanges returns []
//   naturally, so a new business never alerts on day one.
//
// Advise and Expand tiers only. Append ?force=1 to include any tier for
// end-to-end testing. Scheduler: the bundled daily GitHub Action POSTs here
// with `Authorization: Bearer $LOVABLE_CRON_SECRET`.
const COOLDOWN_DAYS = 7;
const ALERTS_PER_USER_PER_DAY = 1;

type AlertTarget = {
  id: string | null;
  userId: string;
  businessName: string;
  businessType: "salon" | "spa" | "other";
  location: string;
  googlePlaceId?: string | undefined;
};

async function runDailyAlerts(request: Request): Promise<Response> {
  const unauthorized = await authenticateCronRequest(request);
  if (unauthorized) return unauthorized;

  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const [{ supabaseAdmin }, { collectLocalResearch }, { detectChanges, classifyAlert, parseResearchSnapshot }, { sendEmail, renderMarketAlert }] =
      await Promise.all([
        import("@/integrations/supabase/client.server"),
        import("@/lib/local-research.server"),
        import("@/lib/change-detection"),
        import("@/lib/email.server"),
      ]);

    // select("*") so pre-migration profile tables (no plan_tier) keep working.
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .not("business_name", "is", null)
      .not("location", "is", null)
      .limit(100);
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);

    const failed: Array<{ businessId: string | null; error: string }> = [];
    let scanned = 0;
    let alerted = 0;
    let emailed = 0;
    let cooledDown = 0;
    let overflowFolded = 0;
    let skippedUnpaid = 0;

    // One email budget per user per day, enforced across all their businesses:
    // the first qualifying alert of the day spends it.
    const emailedToday = new Set<string>();

    for (const profile of profiles ?? []) {
      const tier = (profile as { plan_tier?: string | null }).plan_tier ?? "free";
      if (!force && tier !== "advise" && tier !== "expand") {
        skippedUnpaid += 1;
        continue;
      }

      const { data: businessRows } = await supabaseAdmin
        .from("businesses")
        .select("*")
        .eq("user_id", profile.id);
      const targets: AlertTarget[] = (businessRows ?? [])
        .filter((b) => (b.business_name ?? "").trim() && (b.location ?? "").trim())
        .map((b) => ({
          id: b.id,
          userId: profile.id,
          businessName: b.business_name,
          businessType:
            b.business_type === "spa" || b.business_type === "other"
              ? (b.business_type as "spa" | "other")
              : "salon",
          location: b.location,
          googlePlaceId: (b as { google_place_id?: string | null }).google_place_id ?? undefined,
        }));

      for (const business of targets) {
        try {
          const input = {
            businessName: business.businessName,
            businessType: business.businessType,
            location: business.location,
            googlePlaceId: business.googlePlaceId,
          };

          // Light sweep: Google places search + OSM only. The search
          // response already carries rating/review-count/price-level, so
          // most days need no place-detail calls at all.
          const research = await collectLocalResearch(input, { mode: "preview" });

          const { data: historyRows } = await supabaseAdmin
            .from("monitoring_snapshots")
            .select("snapshot")
            .eq(business.id ? "business_id" : "user_id", business.id ?? profile.id)
            .order("created_at", { ascending: false })
            .limit(2);
          const parsedHistory = (historyRows ?? [])
            .reverse()
            .map((row) => parseResearchSnapshot(row.snapshot))
            .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null);
          const previous = parsedHistory[parsedHistory.length - 1] ?? null;
          const changes = detectChanges(previous, research);

          await supabaseAdmin.from("monitoring_snapshots").insert({
            user_id: profile.id,
            business_id: business.id,
            business_name: input.businessName,
            business_type: input.businessType,
            location: input.location,
            snapshot: research as unknown as Json,
            detected_changes: changes as unknown as Json,
          });

          // Pin the matched own listing so tomorrow's sweep keys on the
          // place ID instead of re-matching the typed name.
          const matchedPlaceId = research.ownListingPlaceId ?? undefined;
          if (matchedPlaceId && matchedPlaceId !== input.googlePlaceId && business.id) {
            const { error: pinError } = await supabaseAdmin
              .from("businesses")
              .update({ google_place_id: matchedPlaceId })
              .eq("id", business.id);
            if (pinError) console.error(`place id persist failed for ${business.id}`, pinError.message);
          }

          scanned += 1;

          // Alerts attach to a business row; the pre-migration profile
          // fallback (business.id null) can only scan, never alert.
          if (changes.length === 0 || !business.id) continue;

          for (const change of changes) {
            const classified = classifyAlert(change);
            if (!classified) continue; // Weekly-brief material only.

            // 7-day cooldown per (business, kind, competitor).
            const { data: recent } = await supabaseAdmin
              .from("market_alerts")
              .select("id")
              .eq("business_id", business.id ?? "")
              .eq("kind", change.kind)
              .gte("created_at", new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString())
              .limit(1);
            if (recent && recent.length > 0) {
              cooledDown += 1;
              continue;
            }

            const { error: insertError } = await supabaseAdmin.from("market_alerts").insert({
              business_id: business.id,
              user_id: profile.id,
              kind: change.kind,
              alert_kind: classified.alertKind,
              tone: classified.verdict,
              headline: change.headline,
              detail: change.detail,
              competitor_name: change.competitorName ?? null,
              email_sent_at: null,
            });
            if (insertError) throw insertError;
            alerted += 1;
          }
        } catch (error) {
          console.error(`alert sweep failed for business ${business.id ?? business.businessName}`, error);
          failed.push({
            businessId: business.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Email phase — AFTER this user's businesses are all scanned, so the
      // 1/day budget is spent on that day's most important alert, not the
      // first business processed. Red beats amber; newest first.
      if (!force || tier === "advise" || tier === "expand") {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: pending } = await supabaseAdmin
          .from("market_alerts")
          .select("id, tone, alert_kind, headline, detail, kind, competitor_name, created_at, businesses ( business_name )")
          .eq("user_id", profile.id)
          .is("email_sent_at", null)
          .gte("created_at", dayAgo)
          .order("created_at", { ascending: false })
          .limit(20);
        const candidates = (pending ?? []).filter((a) => a.tone === "red" || a.tone === "amber");
        if (candidates.length === 0) continue;

        const rank = (a: { tone: string }) => (a.tone === "red" ? 0 : 1);
        candidates.sort((a, b) => rank(a) - rank(b));
        const top = candidates[0];
        if (!top) continue;

        const recipient = await recipientEmail(supabaseAdmin, profile.id);
        if (recipient && !emailedToday.has(profile.id)) {
          const dashboardUrl = requestUrlBase(request);
          const { subject, html, text } = renderMarketAlert({
            kind: (top.alert_kind as Parameters<typeof renderMarketAlert>[0]["kind"]) ?? "general",
            tone: top.tone === "red" ? "red" : "amber",
            headline: top.headline,
            ...(top.detail ? { detail: top.detail } : {}),
            actionLabel: "Open the dashboard",
            actionUrl: `${dashboardUrl}/dashboard`,
            dashboardUrl: `${dashboardUrl}/dashboard`,
          });
          const sent = await sendEmail({ to: recipient, subject, html, text });
          if (sent.ok) {
            await supabaseAdmin.from("market_alerts").update({ email_sent_at: new Date().toISOString() }).eq("id", top.id);
            emailedToday.add(profile.id);
            emailed += 1;
          } else {
            // Stay un-emailed; tomorrow's run retries it.
            console.error(`alert email failed for profile ${profile.id}`, sent.error);
          }
        }

        // Everything past the cap folds into Monday: they are stored rows
        // (surfaced in-app), just never individually emailed.
        overflowFolded += Math.max(0, candidates.length - (emailedToday.has(profile.id) ? 1 : 0));
      }
    }

    return jsonResponse({ ok: true, scanned, alerted, emailed, cooledDown, overflowFolded, skippedUnpaid, failed });
  } catch (error) {
    console.error("runDailyAlerts failed", error);
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}

async function recipientEmail(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")["supabaseAdmin"]>,
  userId: string,
): Promise<string | undefined> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email ?? undefined;
}

function requestUrlBase(request: Request): string {
  try {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://localhost:8080";
  }
}
