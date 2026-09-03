import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Renders "Dashboard" when a session exists, "Log in" otherwise. Shows nothing
// until the session is read so signed-in users don't see a misleading link.
export function AuthNavLink() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session));
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setSignedIn(Boolean(session));
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
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