import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

// Renders "Dashboard" when a session exists, "Log in" otherwise. Shows nothing
// until the session is read so signed-in users don't see a misleading link.
// The Supabase client is loaded lazily inside the effect so supabase-js stays
// out of the landing page's initial bundle.
export function AuthNavLink() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    import("@/integrations/supabase/client")
      .then(({ supabase }) => {
        if (!active) return;
        supabase.auth.getSession().then(({ data }) => {
          if (active) setSignedIn(Boolean(data.session));
        });
        const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
          if (active) setSignedIn(Boolean(session));
        });
        unsubscribe = () => subscription.subscription.unsubscribe();
      })
      .catch(() => {
        // Supabase env vars missing — nothing to authenticate against.
        if (active) setSignedIn(false);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  if (signedIn === null) return null;
  return signedIn ? (
    <Link to="/dashboard" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
      Dashboard
    </Link>
  ) : (
    <Link to="/login" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
      Log in
    </Link>
  );
}
