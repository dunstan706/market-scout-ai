// Lookups into auth.users. PostgREST does not expose the auth schema, so
// .from("users") silently returns nothing (PGRST error, empty data) — GoTrue's
// admin API on the service-role client is the supported way in.
//
// getUserById is a single indexed call. The reverse (email -> id) has no
// server-side filter in the admin list endpoint, so it pages through users;
// page count is capped and the per-page size is the API maximum, which is
// comfortably ahead of the account base for the foreseeable future.
import { supabaseAdmin } from "./client.server";

export async function getAuthEmailById(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error || !data) return null;
    // supabase-js versions differ on the response shape: { user } vs flat.
    const shape = data as { user?: { email?: string } | null; email?: string } | null;
    const email = shape?.user?.email ?? shape?.email ?? null;
    return email ? String(email).toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function getAuthUserIdByEmail(email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  try {
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 500 });
      if (error || !data) return null;
      const users = (data as { users?: Array<{ id?: string; email?: string }> }).users ?? [];
      const match = users.find((u) => (u.email ?? "").toLowerCase() === target);
      if (match?.id) return match.id;
      if (users.length < 500) return null; // last page, no match
    }
  } catch {
    return null;
  }
  return null;
}
