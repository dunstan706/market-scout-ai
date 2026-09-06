"use client";

import { useState } from "react";
import { GlobeDashboard } from "@/components/GlobeDashboard";
import { LegacyDashboard } from "@/components/LegacyDashboard";
import { LegacyDashboardToggle } from "@/components/LegacyDashboardToggle";

// Remembered in the tab session so a reload keeps whichever dashboard the
// user picked.
const MODE_KEY = "localscope-dashboard-mode";

/**
 * Hosts both dashboards under one URL. The LegacyDashboardToggle flips the
 * mode in place (no navigation), and the toggle keeps its exact corner
 * position so the swap looks seamless. The choice is remembered per tab
 * session.
 */
export function DashboardHost() {
  const [legacy, setLegacy] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(MODE_KEY) === "legacy";
    } catch {
      return false;
    }
  });

  function onToggle() {
    setLegacy((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(MODE_KEY, next ? "legacy" : "new");
      } catch {
        // Storage unavailable — the choice just isn't remembered.
      }
      return next;
    });
  }

  return (
    <>
      {legacy ? <LegacyDashboard /> : <GlobeDashboard />}
      {/* One toggle for both dashboards — same fixed corner spot either way.
          Scoped to theme-dark because it lives outside the page mains (which
          carry the class themselves); without it the pill would pick up the
          light :root palette. The wrapper is layout-free (its child is
          fixed). */}
      <div className="theme-dark">
        <LegacyDashboardToggle
          legacy={legacy}
          onToggle={onToggle}
          className="fixed right-4 top-24 z-[70] md:right-6 md:top-6"
        />
      </div>
    </>
  );
}