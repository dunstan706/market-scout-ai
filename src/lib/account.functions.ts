import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Tables } from "@/integrations/supabase/types";
import { BriefSchema } from "@/lib/brief-core";
import { collectLocalResearch, type ResearchSnapshot } from "@/lib/local-research.server";
import { describeBriefError, writeBrief } from "@/lib/brief-writer.server";
import {
  detectChanges,
  parseDetectedChanges,
  parseResearchSnapshot,
  type DetectedChange,
} from "@/lib/change-detection";
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
};

const ProfileInput = z.object({
  businessName: z.string().trim().min(2).max(120),
  businessType: BusinessTypeSchema,
  location: z.string().trim().min(2).max(160),
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
};

type ProfileRow = Tables<"profiles">;

// In development, append the underlying Supabase error so setup problems
// (missing tables from unapplied migrations, RLS mistakes) are visible in the
// UI instead of hidden behind a generic message. Production stays generic.
function describeError(message: string, detail: string | undefined): string {
  if (process.env["NODE_ENV"] === "production" || !detail) return message;
  return `${message} ${detail}`;
}

function toProfile(row: ProfileRow | null): Profile | null {
  if (!row) return null;
  const businessType: BusinessType =
    row.business_type === "spa" || row.business_type === "other" ? row.business_type : "salon";
  return {
    businessName: row.business_name ?? "",
    businessType,
    location: row.location ?? "",
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

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProfileInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.from("profiles").upsert(
      {
        id: context.userId,
        business_name: data.businessName,
        business_type: data.businessType,
        location: data.location,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error("saveProfile failed", error);
      throw new Error(describeError("Could not save your profile.", error.message));
    }
    return { ok: true };
  });

// Runs one full monitoring cycle for the signed-in user's profile:
// 1. fresh research scan, 2. diff vs the latest stored snapshot,
// 3. store the new snapshot with detected changes, 4. write + store the brief.
export const generateMonitoringBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<
      | { ok: true; brief: Brief; changes: DetectedChange[]; monitoredAt: string; baseline: boolean }
      | { ok: false; error: string }
    > => {
      const userId = context.userId;

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

      const { data: latest } = await context.supabase
        .from("monitoring_snapshots")
        .select("snapshot")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const previous = latest ? parseResearchSnapshot(latest.snapshot) : null;
      const changes = detectChanges(previous, research);

      let generated;
      try {
        generated = await writeBrief({ input, research, changes });
      } catch (error) {
        console.error("monitoring brief failed", error);
        return { ok: false, error: describeBriefError(error) };
      }

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
      };
    },
  );

export const getMonitoringStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ status: MonitoringStatus }> => {
    const userId = context.userId;
    const { data: latest } = await context.supabase
      .from("monitoring_snapshots")
      .select("detected_changes, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { count } = await context.supabase
      .from("monitoring_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    return {
      status: {
        lastRunAt: latest?.created_at ?? null,
        baseline: latest === null,
        snapshotCount: count ?? 0,
        changes: latest ? parseDetectedChanges(latest.detected_changes) : [],
      },
    };
  });

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