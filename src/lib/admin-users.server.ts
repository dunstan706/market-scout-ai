// Server-side admin designation. Admins are listed in ADMIN_EMAILS
// (comma-separated env var); the caller's email is always resolved from their
// session user id via GoTrue — never trusted from the client.
//
// Admins are operator accounts: they bypass paywalls (tier caps, subscription
// gates, cron paid-tier filters) for testing and support, but they are NOT
// billed. This module is the single source of truth so every gate agrees.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAuthEmailById } from "@/integrations/supabase/auth-lookup.server";

function adminEmailList(): string[] {
  return (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function adminEmailsConfigured(): boolean {
  return adminEmailList().length > 0;
}

/** Is this account a designated admin (email in ADMIN_EMAILS)? Independent of
 *  the manual privileges switch — call `adminPrivilegesActive` for that. */
export async function isAdminUser(userId: string): Promise<boolean> {
  if (!userId) return false;
  const emails = adminEmailList();
  if (emails.length === 0) return false;
  const email = await getAuthEmailById(userId);
  if (!email) return false;
  return emails.includes(email);
}

/** True only when a designated admin has ALSO switched their manual
 *  "admin privileges" on (profiles.admin_privileges_enabled). Non-admins are
 *  never active regardless of the column — it is only ever read here, behind
 *  the ADMIN_EMAILS check, so flipping it on a normal account does nothing. */
export async function adminPrivilegesActive(userId: string): Promise<boolean> {
  if (!(await isAdminUser(userId))) return false;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("admin_privileges_enabled")
    .eq("id", userId)
    .maybeSingle();
  return Boolean(
    (data as { admin_privileges_enabled?: boolean | null } | null)
      ?.admin_privileges_enabled,
  );
}

// All admin account ids, resolved once per call site (crons use this to
// include admin profiles in paid-tier runs without N per-profile lookups).
export async function getAdminUserIds(): Promise<Set<string>> {
  const { getAuthUserIdByEmail } = await import(
    "@/integrations/supabase/auth-lookup.server"
  );
  const ids = new Set<string>();
  for (const email of adminEmailList()) {
    const id = await getAuthUserIdByEmail(email);
    if (id) ids.add(id);
  }
  return ids;
}

/** All admin account ids whose manual privileges switch is ON. Used by the
 *  crons, which iterate profiles and can consult the row's own flag instead of
 *  paying a GoTrue round-trip per profile. */
export async function getPrivilegedAdminUserIds(): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, admin_privileges_enabled")
    .eq("admin_privileges_enabled", true);
  const designated = await getAdminUserIds();
  const active = new Set<string>();
  for (const row of (data ?? []) as Array<{
    id: string;
    admin_privileges_enabled: boolean | null;
  }>) {
    if (row.admin_privileges_enabled && designated.has(row.id)) active.add(row.id);
  }
  return active;
}

// The billing view of an admin whose privileges are switched ON: treated as
// the internal "expand" tier with access always granted. Used by
// getBillingStatus so every downstream gate (business caps, plan overlays,
// cron paid-tier filters) opens for them without their plan_tier ever being
// touched. Privileges OFF → the admin's real row decides (free-like).
export const ADMIN_BILLING = {
  planTier: "expand" as const,
  accessGranted: true,
  cadence: null,
  subscriptionStatus: null,
  currentPeriodEnd: null,
};
