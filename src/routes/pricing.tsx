import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ConstellationGrid } from "@/components/ConstellationGrid";
import { AnimatedNavFramer } from "@/components/ui/animated-nav-framer";
import { PricingSection, type PricingPlan } from "@/components/ui/pricing";
import { AuthNavLink } from "@/components/AuthNavLink";
import { previewLocalizedPricing } from "@/lib/account.functions";
import { usePaddleCheckout } from "@/lib/use-paddle-checkout";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — theBizScope" },
      {
        name: "description",
        content: "Watch or Advise: weekly market briefs for salons and spas. Country-localized, tax-inclusive pricing.",
      },
    ],
  }),
  // ?tier=&cadence= is the resume-checkout intent handed back by signup/login.
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    tier?: "watch" | "advise" | undefined;
    cadence?: "monthly" | "yearly" | undefined;
  } => {
    const tier = typeof search["tier"] === "string" ? search["tier"] : undefined;
    const cadence = typeof search["cadence"] === "string" ? search["cadence"] : undefined;
    return {
      tier: tier === "watch" || tier === "advise" ? tier : undefined,
      cadence: cadence === "monthly" || cadence === "yearly" ? cadence : undefined,
    };
  },
  component: PricingPage,
});

type PagePlan = Omit<PricingPlan, "tier"> & { tier: "watch" | "advise" | null };

const BASE_PLANS: PagePlan[] = [
  {
    name: "Watch",
    price: "15",
    yearlyPrice: "12",
    period: "month",
    tier: "watch",
    description: "One business with on-demand scans, plus the full picture in your inbox every Monday.",
    features: [
      "1 business",
      "On-demand market scans",
      "Weekly brief by email every Monday",
      "Prices, promotions & hours of up to 5 competitors",
      "Review sentiment summary & your rating rank",
    ],
    buttonText: "Subscribe to Watch",
    href: "#",
  },
  {
    name: "Advise",
    price: "50",
    yearlyPrice: "40",
    period: "month",
    tier: "advise",
    description: "Everything in Watch across up to 5 businesses, with deeper coverage and instant alerts.",
    features: [
      "Everything in Watch",
      "Up to 5 businesses",
      "Up to 15 competitors per business",
      "New openings & closures",
      "Actionable recommendations",
      "Same-day alerts when a rival cuts prices or your rating slips",
    ],
    buttonText: "Subscribe to Advise",
    href: "#",
    isPopular: true,
  },
  {
    name: "Expand",
    price: "Ask for a quote",
    yearlyPrice: "",
    period: "",
    tier: null,
    description: "Unlimited businesses for multi-location owners planning their next branch.",
    features: [
      "Everything in Advise",
      "Unlimited businesses",
      "Multiple locations",
      "Neighbourhood development tracking",
      "Next-location recommendations",
    ],
    buttonText: "Ask for a quote",
    href: "mailto:support@thebizscope.com?subject=theBizScope%20Expand%20quote",
    isPopular: false,
  },
];

// Loosely-typed generated route tree — assert the validated search shape.
type PricingSearch = {
  tier?: "watch" | "advise" | undefined;
  cadence?: "monthly" | "yearly" | undefined;
};

function PricingPage() {
  const router = useRouter();
  const { tier: resumeTier, cadence: resumeCadence } = Route.useSearch() as PricingSearch;
  const fetchPreview = useServerFn(previewLocalizedPricing);
  const [plans, setPlans] = useState<PagePlan[]>(() => BASE_PLANS.map((plan) => ({ ...plan })));
  const [notice, setNotice] = useState<string | null>(null);
  const [isMonthly, setIsMonthly] = useState(true);
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);

  // Paddle.js + one-page overlay checkout.
  const { ready: paddleReady, unavailable, error: paddleError, openCheckout } = usePaddleCheckout();

  // Signed-in state pre-fills checkout email + ties the webhook to the user.
  useEffect(() => {
    let active = true;
    import("@/integrations/supabase/client")
      .then(({ supabase }) => supabase.auth.getUser())
      .then(({ data }) => {
        if (!active) return;
        setUserEmail(data.user?.email ?? undefined);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resume checkout after signup/login: once the session and Paddle are both
  // ready, open the overlay for the plan in the URL, then clean the params so
  // a reload doesn't re-open it. Fired at most once per mount.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    if (!resumeTier || !resumeCadence || !userEmail || !paddleReady) return;
    resumedRef.current = true;
    openCheckout({ tier: resumeTier, cadence: resumeCadence, email: userEmail }).finally(
      () => {
        router.navigate({ to: "/pricing", search: {} });
      },
    );
  }, [resumeTier, resumeCadence, userEmail, paddleReady, openCheckout, router]);

  // Localized, tax-inclusive prices for the visitor's country (IP-resolved).
  useEffect(() => {
    let active = true;
    fetchPreview({ data: { cadence: (isMonthly ? "monthly" : "yearly") as "monthly" | "yearly" } })
      .then((result: {
        prices: Array<{ tier: string; formattedTotal: string; country?: string | null }>;
        error?: string | undefined;
      }) => {
        if (!active) return;
        setPlans((current) =>
          current.map((plan) => {
            if (!plan.tier) return plan;
            const match = result.prices.find((price) => price.tier === plan.tier);
            return match ? { ...plan, localizedTotal: match.formattedTotal } : plan;
          }),
        );
        if (result.prices[0]?.country) {
          setNotice(`Prices shown include tax for ${result.prices[0].country}`);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isMonthly, fetchPreview]);

  const handleSelect = useCallback(
    async (plan: PricingPlan, monthly: boolean) => {
      if (!plan.tier) return;
      // Logged-out visitors sign up first; the picked plan rides along in the
      // URL and the dashboard's plans overlay takes it from there after
      // account creation.
      if (!userEmail) {
        await router.navigate({
          to: "/signup",
          search: { tier: plan.tier, cadence: monthly ? "monthly" : "yearly" },
        });
        return;
      }
      if (!paddleReady) {
        setNotice(paddleError || "Checkout is loading — one moment.");
        return;
      }
      await openCheckout({
        tier: plan.tier,
        cadence: monthly ? "monthly" : "yearly",
        email: userEmail,
      });
    },
    [userEmail, router, paddleReady, openCheckout],
  );

  return (
    <main className="theme-dark relative min-h-screen overflow-x-hidden">
      <ConstellationGrid className="fixed inset-0 h-screen w-full" />
      <div className="relative z-10">
        <AnimatedNavFramer
          logo={
            <a
              href="/"
              className="font-serif text-lg font-bold text-foreground transition-colors hover:text-accent"
              aria-label="theBizScope home"
            >
              theBizScope
            </a>
          }
          items={[
            { name: "Home", href: "/" },
            { name: "Profile", href: "/profile" },
          ]}
          auth={<AuthNavLink />}
          collapsible={false}
        />
        <section className="mx-auto max-w-6xl px-6 pt-32 pb-20">
          <p className="eyebrow text-accent">Pricing</p>
          <h1 className="mt-4 text-4xl leading-tight md:text-5xl font-serif">
            Less than one lost regular customer.
          </h1>
          <p className="mt-4 max-w-xl text-muted-foreground">
            Per month, per location. Prices shown are tax-inclusive for your country.
          </p>
          {paddleError ? (
            <p className="mt-2 text-xs text-red-300" role="alert">
              {paddleError}
              {unavailable ? " Add PADDLE_CLIENT_TOKEN to the environment to enable checkout." : ""}
            </p>
          ) : notice ? (
            <p className="mt-2 text-xs text-muted-foreground">{notice}</p>
          ) : null}
        </section>
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <PricingSection
            plans={plans.map((plan) => {
              const { tier, ...rest } = plan;
              // Expand (tier: null) must omit the field entirely so the
              // generic pricing card treats it as non-checkout.
              return tier ? { ...rest, tier } : rest;
            })}
            eyebrow=""
            title=""
            description=""
            className="bg-transparent py-0"
            onSelect={handleSelect}
            isMonthly={isMonthly}
            onIsMonthlyChange={setIsMonthly}
          />
        </section>
        <footer className="mx-auto max-w-6xl px-6 pb-16 text-xs text-muted-foreground">
          <p>
            Checkout is handled by Paddle — the merchant of record — so VAT/sales tax is calculated and
            collected for your country. Cancel any time from the customer portal.
          </p>
          <div className="mt-3 flex items-center gap-5">
            <Link to="/privacy" className="underline decoration-rule underline-offset-2 hover:text-foreground">
              Privacy
            </Link>
            <Link to="/terms" className="underline decoration-rule underline-offset-2 hover:text-foreground">
              Terms
            </Link>
            <Link to="/refund" className="underline decoration-rule underline-offset-2 hover:text-foreground">
              Refunds
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
