"use client";

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  getBillingStatus,
  getIsAdmin,
  setAdminPrivileges,
} from "@/lib/account.functions";
import { ADMIN_PRIVILEGES_EVENT } from "@/lib/use-business-manager";

// Remembered per tab so flipping dashboards back and forth doesn't re-fetch
// admin status on every swap; the truth still re-syncs on every fresh load of
// the host, and the server re-checks privileges on every gated call anyway —
// this cache only decides whether the switch renders.
const ADMIN_SEEN_KEY = "thebizscope-is-admin";

const switchCls =
  "data-[state=checked]:bg-accent data-[state=unchecked]:bg-rule/70";

/**
 * Manual "admin privileges" switch, rendered directly under the legacy
 * dashboard toggle. Only designated admins (ADMIN_EMAILS) ever see it. ON:
 * the account sails past every paywall as the internal expand tier. OFF: it
 * reads exactly like a free account — real tier, real caps, no bypass.
 */
export function AdminPrivilegesToggle({ className }: { className?: string }) {
  const checkAdmin = useServerFn(getIsAdmin);
  const flipPrivileges = useServerFn(setAdminPrivileges);
  const fetchBilling = useServerFn(getBillingStatus);

  const [isAdmin, setIsAdmin] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(ADMIN_SEEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Resolve admin status fresh on mount (the session cache is just a
  // first-paint hint) and read the switch's real position from the profile.
  useEffect(() => {
    let active = true;
    checkAdmin()
      .then(({ isAdmin: designated }) => {
        if (!active) return;
        setIsAdmin(designated);
        try {
          if (designated) sessionStorage.setItem(ADMIN_SEEN_KEY, "1");
          else sessionStorage.removeItem(ADMIN_SEEN_KEY);
        } catch {
          // Storage unavailable — state still applies for this mount.
        }
      })
      .catch(() => {
        // Signed out or lookup unavailable — the switch stays hidden.
      });
    return () => {
      active = false;
    };
  }, [checkAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    // The billing view already reflects the privileges switch (expand +
    // accessGranted when ON), so read the switch's position from it.
    fetchBilling()
      .then(({ status }) => {
        if (active) setChecked(status.accessGranted && status.planTier === "expand");
      })
      .catch(() => {
        // Billing unavailable — leave unchecked until a manual flip.
      });
    return () => {
      active = false;
    };
  }, [isAdmin, fetchBilling]);

  async function handleToggle(next: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await flipPrivileges({ data: { enabled: next } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChecked(result.enabled);
      // Both dashboards' tier gates read from useBusinessManager — the event
      // makes them re-fetch billing this instant, so the very next tap (add
      // business, plans) sees the new reality with no reload.
      window.dispatchEvent(new Event(ADMIN_PRIVILEGES_EVENT));
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className={cn("flex flex-col items-end gap-2", className)}>
      <div className="flex items-center gap-2 rounded-full border border-rule bg-background/80 py-1.5 pl-3.5 pr-1.5 shadow-lg backdrop-blur-sm transition-colors hover:border-accent/60">
        <span className="text-xs font-medium text-muted-foreground">
          Admin privileges
        </span>
        <Switch
          checked={checked}
          onCheckedChange={handleToggle}
          disabled={busy}
          aria-label="Toggle admin privileges — bypass paywalls for testing"
          className={switchCls}
        />
      </div>
      {error ? (
        <p className="max-w-48 rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1 text-right text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
