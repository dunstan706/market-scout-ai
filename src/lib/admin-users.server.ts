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

export async function isAdminUser(userId: string): Promise<boolean> {
  if (!userId) return false;
  const emails = adminEmailList();
  if (emails.length === 0) return false;
  const email = await getAuthEmailById(userId);
  if (!email) return false;
  return emails.includes(email);
}

// All admin account ids, resolved once per call site (crons use this to
// include admin profiles in paid-tier runs without N per-profile lookups).
export async function getAdminUserIds(): Promise<Set<string>> {
  const { getAuthUserIdByEmail } = await import("@/integrations/supabase/auth-lookup.server");
  const ids = new Set<string>();
  for (const email of adminEmailList()) {
    const id = await getAuthUserIdByEmail(email);
    if (id) ids.add(id);
  }
  return ids;
}

// The billing view of an admin: treated as the internal "expand" tier with
// access always granted. Used by getBillingStatus so every downstream gate
// (business caps, plan overlays, cron paid-tier filters) opens for admins
// without their profile row ever being touched.
export const ADMIN_BILLING = {
  planTier: "expand" as const,
  accessGranted: true,
  cadence: null,
  subscriptionStatus: null,
  currentPeriodEnd: null,
};
