import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/cron/run-monitoring")({
  staticData: { sitemap: false },
  // API-only route — never rendered as a page.
  component: () => null,
  server: {
    handlers: {
      POST: async ({ request }) => runWeeklyMonitoring(request),
    },
  },
});

type RunResult = {
  ok: boolean;
  processed?: number;
  emailed?: number;
  skippedUnpaid?: number;
  failed?: Array<{ profileId: string; error: string }>;
  error?: string;
};

function jsonResponse(payload: RunResult, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Runs one full monitoring cycle per paid profile: fresh research scan →
// diff vs the profile's latest snapshot → store the snapshot → write + store
// the brief → email the brief. Emails are only sent for briefs with no
// emailed_at, so re-running the job (or a scheduler retry) never double-sends.
//
// The weekly digest is a paid-tier feature (Watch and above): free profiles
// are skipped without spending any research budget. Append `?force=1` to
// include them — for end-to-end testing before a real subscription exists.
// Point your scheduler at this route with `Authorization: Bearer $LOVABLE_CRON_SECRET`
// (the bundled GitHub Action already does this weekly).
async function runWeeklyMonitoring(request: Request): Promise<Response> {
  const unauthorized = await authenticateCronRequest(request);
  if (unauthorized) return unauthorized;

  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const [
      { supabaseAdmin },
      { collectLocalResearch },
      { writeBrief },
      { detectChanges, parseResearchSnapshot },
      { buildMarketAnalysis },
      { sendEmail, renderBriefEmail },
      { syncScanToWorkspace },
    ] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/local-research.server"),
      import("@/lib/brief-writer.server"),
      import("@/lib/change-detection"),
      import("@/lib/market-analysis"),
      import("@/lib/email.server"),
      import("@/lib/workspace-sync.server"),
    ]);

    // select("*") (not an explicit column list) so a profile table that has
    // not yet received the optional price_point migration still works — the
    // column simply reads as absent.
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .not("business_name", "is", null)
      .not("location", "is", null)
      .limit(100);
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);

    const failed: Array<{ profileId: string; error: string }> = [];
    let processed = 0;
    let emailed = 0;
    let skippedUnpaid = 0;

    // Paid tiers only (column tolerated as absent — select("*")). Each paid
    // profile then fans out to ALL of its businesses — the weekly digest is
    // per business, so an Advise account with three businesses gets three
    // briefs. Falls back to the profile's own business fields when the
    // businesses table is not yet migrated (pre-deploy DBs keep working).
    const { getPrivilegedAdminUserIds } = await import("@/lib/admin-users.server");
    const adminIds = await getPrivilegedAdminUserIds();
    for (const profile of profiles ?? []) {
      const tier = (profile as { plan_tier?: string | null }).plan_tier ?? "free";
      const isAdmin = adminIds.has(profile.id);
      // Admins with the privileges switch ON are operator seats: always
      // treated as paid regardless of their profile's plan_tier.
      if (
        !force &&
        !isAdmin &&
        tier !== "watch" &&
        tier !== "advise" &&
        tier !== "expand"
      ) {
        skippedUnpaid += 1;
        continue;
      }

      const { data: businessRows } = await supabaseAdmin
        .from("businesses")
        .select("*")
        .eq("user_id", profile.id);
      const targets: Array<{
        id: string | null;
        businessName: string;
        businessType: "salon" | "spa" | "other";
        location: string;
        googlePlaceId?: string | undefined;
        pricePoint?: string | undefined;
      }> = (businessRows ?? [])
        .filter((b) => (b.business_name ?? "").trim() && (b.location ?? "").trim())
        .map((b) => ({
          id: b.id,
          businessName: b.business_name,
          businessType:
            b.business_type === "spa" || b.business_type === "other"
              ? (b.business_type as "spa" | "other")
              : "salon",
          location: b.location,
          googlePlaceId: (b as { google_place_id?: string | null }).google_place_id ?? undefined,
          pricePoint: (b as { price_point?: string | null }).price_point ?? undefined,
        }));
      if (targets.length === 0) {
        const businessName = profile.business_name ?? "";
        const location = profile.location ?? "";
        if (businessName.trim() && location.trim()) {
          targets.push({
            id: null,
            businessName,
            businessType:
              profile.business_type === "spa" || profile.business_type === "other"
                ? (profile.business_type as "spa" | "other")
                : "salon",
            location,
            googlePlaceId:
              (profile as { google_place_id?: string | null }).google_place_id ?? undefined,
            pricePoint:
              (profile as { price_point?: string | null }).price_point ?? undefined,
          });
        }
      }

      for (const business of targets) {
        try {
          const input = {
            businessName: business.businessName,
            businessType: business.businessType,
            location: business.location,
            // Pin from a previous successful match, when present: the own-listing
            // lookup targets the place ID directly instead of re-matching names.
            googlePlaceId: business.googlePlaceId,
          };

          // Full mode: the weekly mail is where the Watch tier's richer,
          // multi-source picture (Google + OSM + Foursquare + Geoapify +
          // Overture) is meant to land. User-initiated scans stay on the
          // conservative "preview" mode by default.
          const research = await collectLocalResearch(input, { mode: "full" });

          // History for THIS business when it has an id (post-migration);
          // account-wide history as the pre-migration fallback.
          const { data: historyRows } = await supabaseAdmin
            .from("monitoring_snapshots")
            .select("snapshot")
            .eq(business.id ? "business_id" : "user_id", business.id ?? profile.id)
            .order("created_at", { ascending: false })
            .limit(8);
          const parsedHistory = (historyRows ?? [])
            .reverse()
            .map((row) => parseResearchSnapshot(row.snapshot))
            .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null);
          const previous = parsedHistory[parsedHistory.length - 1] ?? null;
          const changes = detectChanges(previous, research);

          const generated = await writeBrief({
            input,
            research,
            changes,
            analysis: buildMarketAnalysis(research, parsedHistory, business.pricePoint ?? null),
          });

          await supabaseAdmin.from("monitoring_snapshots").insert({
            user_id: profile.id,
            business_id: business.id,
            business_name: input.businessName,
            business_type: input.businessType,
            location: input.location,
            snapshot: research as unknown as Json,
            detected_changes: changes as unknown as Json,
          });

          // Mirror scan findings into the market workspace (competitors +
          // facts). Manual entries always win; the weekly run fills gaps and
          // flags changed values for review. Sync failures never fail the run.
          if (business.id) {
            try {
              const syncResult = await syncScanToWorkspace(supabaseAdmin, business.id, profile.id, research);
              if (syncResult.errors.length > 0) {
                console.error(`workspace sync issues for ${business.id}`, syncResult.errors);
              }
            } catch (syncError) {
              console.error(`workspace sync failed for ${business.id}`, syncError);
            }
          }

          // Pin the matched listing on the business row so future weekly runs
          // key on the place ID instead of re-matching the typed name.
          const matchedPlaceId = research.ownListingPlaceId ?? undefined;
          if (matchedPlaceId && matchedPlaceId !== input.googlePlaceId && business.id) {
            const { error: pinError } = await supabaseAdmin
              .from("businesses")
              .update({ google_place_id: matchedPlaceId })
              .eq("id", business.id);
            if (pinError) console.error(`place id persist failed for ${business.id}`, pinError.message);
          }

          const { data: inserted, error: insertError } = await supabaseAdmin
            .from("briefs")
            .insert({
              user_id: profile.id,
              business_id: business.id,
              business_name: input.businessName,
              business_type: input.businessType,
              location: input.location,
              brief: {
                ...generated,
                sources: research.sources,
                warnings: research.warnings,
                capturedAt: research.capturedAt,
              } as unknown as Json,
            })
            .select("id")
            .single();
          if (insertError) throw insertError;

          // Fresh brief — deliver it by email when a sender is configured.
          const recipient = await recipientEmail(supabaseAdmin, profile.id);
          if (recipient) {
            const { subject, html, text } = renderBriefEmail({
              title: generated.title,
              signals: generated.signals,
              recommendation: generated.recommendation,
              why: generated.why,
              sources: research.sources.map((source) => ({ label: source.label, url: source.url })),
              dashboardUrl: `${requestUrlBase(request)}/dashboard`,
            });
            const sent = await sendEmail({ to: recipient, subject, html, text });
            if (sent.ok) {
              await supabaseAdmin.from("briefs").update({ emailed_at: new Date().toISOString() }).eq("id", inserted.id);
              emailed += 1;
            } else {
              // Logged, not fatal: the brief stays stored and un-emailed, so the
              // next run retries delivery.
              console.error(`email failed for profile ${profile.id}`, sent.error);
            }
          }

          processed += 1;
        } catch (error) {
          console.error(`monitoring failed for profile ${profile.id}`, error);
          failed.push({
            profileId: profile.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return jsonResponse({ ok: true, processed, emailed, skippedUnpaid, failed });
  } catch (error) {
    console.error("runWeeklyMonitoring failed", error);
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}

async function recipientEmail(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
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