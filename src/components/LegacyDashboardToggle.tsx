"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Remembered in the tab session so the mobile prompt doesn't reappear on every
// navigation after the user dismisses it.
const PROMPT_KEY = "thebizscope-legacy-mobile-prompt";

const switchCls =
  "data-[state=checked]:bg-accent data-[state=unchecked]:bg-rule/70";

/**
 * Corner switch that connects the two dashboards: the new globe dashboard
 * (legacy=false, switch off) and the legacy dashboard (legacy=true, switch
 * on). Flipping it calls onToggle so the host page swaps dashboards in place —
 * no navigation, so the switch stays put and the swap feels instant. On the
 * new dashboard it also shows a one-per-session prompt on mobile recommending
 * the legacy layout, with the same switch below it.
 */
export function LegacyDashboardToggle({
  legacy,
  onToggle,
  className,
}: {
  /** True when the legacy dashboard is showing — switch shows on. */
  legacy: boolean;
  /** Flip the dashboard mode in place. */
  onToggle: () => void;
  /** Positioning — "fixed right-4 top-24 z-[70]..." on both dashboards, or
   *  plain inline where a page wants its own placement. */
  className?: string;
}) {
  const [prompt, setPrompt] = useState(false);

  useEffect(() => {
    if (legacy) return;
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(PROMPT_KEY) === "1";
    } catch {
      // Storage unavailable — show the prompt.
    }
    if (isMobile && !dismissed) setPrompt(true);
  }, [legacy]);

  function dismissPrompt() {
    setPrompt(false);
    try {
      sessionStorage.setItem(PROMPT_KEY, "1");
    } catch {
      // Storage unavailable — it just reappears next time.
    }
  }

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-rule bg-background/80 py-1.5 pl-3.5 pr-1.5 shadow-lg backdrop-blur-sm transition-colors hover:border-accent/60",
          className,
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Legacy dashboard
        </button>
        <Switch
          checked={legacy}
          onCheckedChange={onToggle}
          aria-label="Toggle between the new and legacy dashboards"
          className={switchCls}
        />
      </div>

      {prompt && !legacy && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4" data-skip-globe>
          <div
            className="animate-fade absolute inset-0 bg-black/50 backdrop-blur-md"
            onClick={dismissPrompt}
            data-skip-globe
          />
          <div
            className="paper-card animate-rise relative w-full max-w-sm rounded-md p-7 shadow-lift"
            data-skip-globe
          >
            <button
              type="button"
              aria-label="Close"
              onClick={dismissPrompt}
              className="absolute right-3 top-3 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-rule/60 hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <p className="eyebrow">Mobile</p>
            <h2 className="mt-2 font-serif text-2xl leading-snug">
              The Legacy dashboard is recommended for mobile devices
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The classic layout fits small screens better. Switch any time from the top-right
              toggle — both dashboards stay in sync.
            </p>
            <div className="mt-6 flex items-center justify-between rounded-sm border border-rule bg-card/40 px-4 py-3 transition-colors hover:border-accent/60">
              <button
                type="button"
                onClick={onToggle}
                className="text-sm font-medium text-foreground"
              >
                Legacy dashboard
              </button>
              <Switch
                checked={legacy}
                onCheckedChange={onToggle}
                aria-label="Switch to the legacy dashboard"
                className={switchCls}
              />
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Not now —{" "}
              <button
                type="button"
                onClick={dismissPrompt}
                className="underline underline-offset-2 transition-colors hover:text-foreground"
              >
                dismiss
              </button>
            </p>
          </div>
        </div>
      )}
    </>
  );
}