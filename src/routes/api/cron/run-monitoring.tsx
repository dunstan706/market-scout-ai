import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/cron/run-monitoring")({
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
  failed?: Array<{ profileId: string; error: string }>;
  error?: string;
};

function jsonResponse(payload: RunResult, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Runs one full monitoring cycle per saved profile: fresh research scan →
// diff vs the profile's latest snapshot → store the snapshot → write + store
// the brief. Point your scheduler (e.g. weekly, Monday 08:00) at this route
// with `Authorization: Bearer $LOVABLE_CRON_SECRET`.
async function runWeeklyMonitoring(request: Request): Promise<Response> {
  const unauthorized = await authenticateCronRequest(request);
  if (unauthorized) return unauthorized;

  try {
    const [{ supabaseAdmin }, { collectLocalResearch }, { writeBrief }, { detectChanges, parseResearchSnapshot }] =
      await Promise.all([
        import("@/integrations/supabase/client.server"),
        import("@/lib/local-research.server"),
        import("@/lib/brief-writer.server"),
        import("@/lib/change-detection"),
      ]);

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, business_name, business_type, location")
      .not("business_name", "is", null)
      .not("location", "is", null)
      .limit(100);
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);

    const failed: Array<{ profileId: string; error: string }> = [];
    let processed = 0;

    for (const profile of profiles ?? []) {
      const businessName = profile.business_name ?? "";
      const location = profile.location ?? "";
      if (!businessName.trim() || !location.trim()) continue;
      try {
        const input = {
          businessName,
          businessType:
            profile.business_type === "spa" || profile.business_type === "other"
              ? profile.business_type
              : "salon",
          location,
        };

        const research = await collectLocalResearch(input);

        const { data: latest } = await supabaseAdmin
          .from("monitoring_snapshots")
          .select("snapshot")
          .eq("user_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const previous = latest ? parseResearchSnapshot(latest.snapshot) : null;
        const changes = detectChanges(previous, research);

        const generated = await writeBrief({ input, research, changes });

        await supabaseAdmin.from("monitoring_snapshots").insert({
          user_id: profile.id,
          business_name: input.businessName,
          business_type: input.businessType,
          location: input.location,
          snapshot: research as unknown as Json,
          detected_changes: changes as unknown as Json,
        });

        await supabaseAdmin.from("briefs").insert({
          user_id: profile.id,
          business_name: input.businessName,
          business_type: input.businessType,
          location: input.location,
          brief: {
            ...generated,
            sources: research.sources,
            warnings: research.warnings,
            capturedAt: research.capturedAt,
          } as unknown as Json,
        });

        processed += 1;
      } catch (error) {
        console.error(`monitoring failed for profile ${profile.id}`, error);
        failed.push({
          profileId: profile.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return jsonResponse({ ok: true, processed, failed });
  } catch (error) {
    console.error("runWeeklyMonitoring failed", error);
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}