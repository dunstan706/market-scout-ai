import { createMiddleware } from "@tanstack/react-start";

// Client middleware that attaches the Supabase bearer token to serverFn RPCs.
// Mirrors integrations/supabase/auth-attacher.ts but imports the browser
// client lazily, so supabase-js becomes an on-demand chunk instead of being
// bundled into the app's initial entry chunk.
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
