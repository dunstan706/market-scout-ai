"use client";

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PricingSection, type PricingPlan } from "@/components/ui/pricing";
import { startCheckout } from "@/lib/account.functions";

// Plans for the upgrade overlay — mirrors the landing page's pricing, with
// yearly prices for the toggle and the same three tiers.
export const PRICING_PLANS: PricingPlan[] = [
  {
    name: "Watch",
    price: "15",
    yearlyPrice: "12",
    period: "month",
    description: "Weekly brief for one location, up to 5 competitors.",
    features: [
      "Weekly Market Brief",
      "Prices, promotions & hours",
      "Review sentiment summary",
      "Market snapshot & your rating rank",
    ],
    buttonText: "Current plan",
    href: "#",
    tier: "watch",
  },
  {
    name: "Advise",
    price: "50",
    yearlyPrice: "40",
    period: "month",
    description: "Deeper intelligence plus recommendations you can act on.",
    features: [
      "Everything in Watch",
      "Up to 15 competitors",
      "New openings & closures",
      "Actionable recommendations",
      "Instant alerts on big moves",
      "Up to 5 businesses",
    ],
    buttonText: "Upgrade",
    href: "#",
    isPopular: true,
    tier: "advise",
  },
  {
    name: "Expand",
    price: "Ask for a quote",
    yearlyPrice: "",
    period: "",
    description: "Multi-location owners and those planning the next branch.",
    features: [
      "Everything in Advise",
      "Multiple locations",
      "Neighbourhood development tracking",
      "Next-location recommendations",
      "Unlimited businesses",
    ],
    buttonText: "Ask for a quote",
    href: "#",
  },
];

/**
 * Plans / upgrade overlay — no card behind it, just the floating upgrade note,
 * billing toggle and the three plan blocks over a dark, blurred backdrop.
 * Closes on backdrop press, Escape, or whatever close affordance the host
 * page provides (the + pill rotates to an × while open).
 */
export function UpgradeOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const requestCheckout = useServerFn(startCheckout);
  const [checkoutError, setCheckoutError] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const handleSelect = useCallback(
    async (plan: PricingPlan, isMonthly: boolean) => {
      if (!plan.tier) return;
      setCheckoutError("");
      try {
        const result = await requestCheckout({
          data: { tier: plan.tier, cadence: isMonthly ? "monthly" : "yearly" },
        });
        if (result.ok) {
          window.location.href = result.url;
        } else {
          setCheckoutError(result.error);
        }
      } catch {
        setCheckoutError("Could not start checkout. Please try again.");
      }
    },
    [requestCheckout],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" data-skip-globe>
      <div
        className="animate-fade absolute inset-0 bg-black/50 backdrop-blur-md"
        onClick={onClose}
        data-skip-globe
      />
      <div className="animate-rise relative w-full max-w-5xl" data-skip-globe>
        {checkoutError ? (
          <p className="relative z-10 mx-auto mb-3 max-w-2xl rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-xs text-red-300">
            {checkoutError}
          </p>
        ) : null}
        <PricingSection
          plans={PRICING_PLANS}
          eyebrow=""
          title="Upgrade your plan to add more businesses"
          description=""
          compact
          className="bg-transparent py-6 sm:py-8"
          onSelect={handleSelect}
        />
      </div>
    </div>
  );
}