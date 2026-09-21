"use client";

import { motion } from "framer-motion";
import React, {
  useState,
  useRef,
  useEffect,
  createContext,
  useContext,
} from "react";
import confetti from "canvas-confetti";
import { Check, Star as LucideStar } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// --- BASE UI COMPONENTS (BUTTON) ---

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export function useMediaQuery(query: string) {
  const [value, setValue] = useState(false);

  useEffect(() => {
    function onChange(event: MediaQueryListEvent) {
      setValue(event.matches);
    }

    const result = matchMedia(query);
    result.addEventListener("change", onChange);
    setValue(result.matches);

    return () => result.removeEventListener("change", onChange);
  }, [query]);

  return value;
}

// --- PRICING COMPONENT LOGIC ---

// Interfaces
export interface PricingPlan {
  name: string;
  /** Numeric monthly price as a string (e.g. "15"), or any display text
   *  (e.g. "Ask for a quote") for plans without a fixed price. */
  price: string;
  yearlyPrice: string;
  period: string;
  features: string[];
  description: string;
  buttonText: string;
  href: string;
  isPopular?: boolean;
  /** Stable tier id used by billing ("watch" / "advise"); plans without one
   *  (e.g. the quote-only Expand tier) never trigger checkout. */
  tier?: "watch" | "advise";
  /** Country-localized, tax-inclusive total from Paddle's pricing preview.
   *  When present it replaces the USD base price display so the page shows
   *  exactly what checkout will charge in the visitor's location. */
  localizedTotal?: string;
}

interface PricingSectionProps {
  plans: PricingPlan[];
  /** Small uppercase label above the title; hidden when empty. */
  eyebrow?: string;
  title?: string;
  description?: string;
  /** Merged into the outer section — pass e.g. "bg-transparent py-6" when
   *  the section is rendered inside an overlay. */
  className?: string;
  /** Tightens paddings and type so the section fits a viewport without
   *  scrolling — used inside the upgrade overlay. */
  compact?: boolean;
  /** When provided, plan buttons call this instead of navigating to
   *  `href` — used by the dashboard overlay to start Paddle checkout with
   *  the currently selected billing cadence. */
  onSelect?: ((plan: PricingPlan, isMonthly: boolean) => void) | undefined;
  /** Controlled cadence: pass both to own the Monthly/Annual toggle from the
   *  host page (e.g. to re-fetch localized prices). Omit for the default
   *  self-contained behaviour. */
  isMonthly?: boolean;
  onIsMonthlyChange?: ((monthly: boolean) => void) | undefined;
  /** The viewer's plan tier — plan cards at or below it read "Current plan"
   *  / "Included in your plan" and disable, instead of offering an upgrade
   *  the user already has. Omit on public pricing pages. */
  currentTier?: "free" | "watch" | "advise" | "expand" | undefined;
}

// Context for state management
const PricingContext = createContext<{
  isMonthly: boolean;
  setIsMonthly: (value: boolean) => void;
  onSelect?: ((plan: PricingPlan, isMonthly: boolean) => void) | undefined;
  currentTier?: "free" | "watch" | "advise" | "expand" | undefined;
}>({
  isMonthly: true,
  setIsMonthly: () => {},
});

// Main PricingSection Component
export function PricingSection({
  plans,
  eyebrow = "Pricing",
  title = "Simple, Transparent Pricing",
  description = "Choose the plan that's right for you. All plans include our core features and support.",
  className,
  compact = false,
  onSelect,
  isMonthly: isMonthlyProp,
  onIsMonthlyChange,
  currentTier,
}: PricingSectionProps) {
  const [internalMonthly, setInternalMonthly] = useState(true);
  const controlled = isMonthlyProp !== undefined && onIsMonthlyChange !== undefined;
  const isMonthly = controlled ? isMonthlyProp : internalMonthly;
  const setIsMonthly = (value: boolean) => {
    if (controlled) onIsMonthlyChange(value);
    else setInternalMonthly(value);
  };

  return (
    <PricingContext.Provider value={{ isMonthly, setIsMonthly, onSelect, currentTier }}>

      <div
        className={cn(
          "relative w-full bg-background py-20 sm:py-24",
          className,
        )}
      >
        <div className="relative z-10 mx-auto max-w-5xl px-4 md:px-6">
          <div
            className={cn(
              "mx-auto max-w-3xl space-y-3 text-center",
              compact ? "mb-4" : "mb-10",
            )}
          >
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && (
              <h2
                className={cn(
                  "font-bold tracking-tight text-foreground",
                  compact ? "text-xl sm:text-2xl" : "text-3xl sm:text-4xl",
                )}
              >
                {title}
              </h2>
            )}
            {description && (
              <p className="whitespace-pre-line text-lg text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <PricingToggle compact={compact} />
          <div
            className={cn(
              "grid items-start",
              compact
                ? "mt-5 grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-3"
                : "mt-12 grid-cols-1 gap-8 lg:grid-cols-3",
            )}
          >
            {plans.map((plan, index) => (
              <PricingCard key={plan.name} plan={plan} index={index} compact={compact} />
            ))}
          </div>
        </div>
      </div>
    </PricingContext.Provider>
  );
}

// Pricing Toggle Component
function PricingToggle({ compact = false }: { compact?: boolean }) {
  const { isMonthly, setIsMonthly } = useContext(PricingContext);
  const confettiRef = useRef<HTMLDivElement>(null);
  const monthlyBtnRef = useRef<HTMLButtonElement>(null);
  const annualBtnRef = useRef<HTMLButtonElement>(null);

  const [pillStyle, setPillStyle] = useState({});

  useEffect(() => {
    const btnRef = isMonthly ? monthlyBtnRef : annualBtnRef;
    if (btnRef.current) {
      setPillStyle({
        width: btnRef.current.offsetWidth,
        transform: `translateX(${btnRef.current.offsetLeft}px)`,
      });
    }
  }, [isMonthly]);

  const handleToggle = (monthly: boolean) => {
    if (isMonthly === monthly) return;
    setIsMonthly(monthly);

    if (!monthly && confettiRef.current) {
      const rect = annualBtnRef.current?.getBoundingClientRect();
      if (!rect) return;

      const originX = (rect.left + rect.width / 2) / window.innerWidth;
      const originY = (rect.top + rect.height / 2) / window.innerHeight;

      confetti({
        particleCount: 80,
        spread: 80,
        origin: { x: originX, y: originY },
        colors: [
          "hsl(var(--primary))",
          "hsl(var(--background))",
          "hsl(var(--accent))",
        ],
        ticks: 300,
        gravity: 1.2,
        decay: 0.94,
        startVelocity: 30,
      });
    }
  };

  return (
    <div className="flex justify-center">
      <div
        ref={confettiRef}
        className="relative flex w-fit items-center rounded-full bg-muted p-1"
      >
        <motion.div
          className="absolute left-0 top-0 h-full rounded-full bg-primary p-1"
          style={pillStyle}
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
        <button
          ref={monthlyBtnRef}
          onClick={() => handleToggle(true)}
          className={cn(
            "relative z-10 rounded-full text-sm font-medium transition-colors",
            compact ? "px-3.5 py-1.5 sm:px-5" : "px-4 py-2 sm:px-6",
            isMonthly
              ? "text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Monthly
        </button>
        <button
          ref={annualBtnRef}
          onClick={() => handleToggle(false)}
          className={cn(
            "relative z-10 rounded-full text-sm font-medium transition-colors",
            compact ? "px-3.5 py-1.5 sm:px-5" : "px-4 py-2 sm:px-6",
            !isMonthly
              ? "text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Annual
          <span
            className={cn(
              "hidden sm:inline",
              !isMonthly ? "text-primary-foreground/80" : "",
            )}
          >
            {" "}
            (Save 20%)
          </span>
        </button>
      </div>
    </div>
  );
}

// Pricing Card Component
function PricingCard({
  plan,
  index,
  compact = false,
}: {
  plan: PricingPlan;
  index: number;
  compact?: boolean;
}) {
  const { isMonthly, onSelect, currentTier } = useContext(PricingContext);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // Tier awareness: at the current tier the button reads "Current plan";
  // tiers already included in the subscription read "Included in your plan".
  // Both disable the CTA — no paying for something you have.
  const TIER_ORDER = { free: 0, watch: 1, advise: 2, expand: 3 } as const;
  const viewerRank = currentTier ? TIER_ORDER[currentTier] : undefined;
  const planRank = plan.tier ? TIER_ORDER[plan.tier] : undefined;
  const isCurrentTier =
    viewerRank !== undefined && planRank !== undefined && planRank === viewerRank;
  const isIncludedTier =
    viewerRank !== undefined && planRank !== undefined && planRank < viewerRank;
  const isDisabledPlan = isCurrentTier || isIncludedTier;
  // "Upgrade" is only meaningful when moving up from a paid plan — a free
  // viewer is simply subscribing, so they see the plan's own button text.
  const isUpgradeStep =
    viewerRank !== undefined &&
    planRank !== undefined &&
    viewerRank > 0 &&
    planRank === viewerRank + 1;
  const buttonLabel = isCurrentTier
    ? "Current plan"
    : isIncludedTier
      ? "Included in your plan"
      : isUpgradeStep
        ? "Upgrade"
        : plan.buttonText;

  const numericPrice = Number(plan.price);
  const hasFixedPrice = plan.price.trim() !== "" && !Number.isNaN(numericPrice);
  const shownPrice = isMonthly
    ? Number(plan.price)
    : Number(plan.yearlyPrice || plan.price);

  return (
    <motion.div
      initial={{ y: 50, opacity: 0 }}
      whileInView={{
        y: plan.isPopular && isDesktop ? -20 : 0,
        opacity: 1,
      }}
      viewport={{ once: true }}
      transition={{
        duration: 0.6,
        type: "spring",
        stiffness: 100,
        damping: 20,
        delay: index * 0.15,
      }}
      className={cn(
        "relative flex flex-col rounded-2xl bg-background/70 backdrop-blur-sm",
        compact ? "p-4" : "p-8",
        plan.isPopular
          ? "border-2 border-accent shadow-xl"
          : "border border-border",
      )}
    >
      {plan.isPopular && (
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
          <div className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5">
            <LucideStar className="h-4 w-4 fill-current text-accent-foreground" />
            <span className="text-sm font-semibold text-accent-foreground">
              Most Popular
            </span>
          </div>
        </div>
      )}
      <div className="flex flex-1 flex-col text-center">
        <h3 className="text-xl font-semibold text-foreground">{plan.name}</h3>
        <p
          className={cn(
            "text-muted-foreground",
            compact ? "mt-1.5 text-xs leading-[18px]" : "mt-2 text-sm",
          )}
        >
          {plan.description}
        </p>
        <div className={cn("flex items-baseline justify-center gap-x-1", compact ? "mt-3" : "mt-6")}>
          {hasFixedPrice && plan.localizedTotal ? (
            <span
              className={cn(
                "font-bold tracking-tight text-foreground",
                compact ? "text-3xl" : "text-5xl",
              )}
            >
              {plan.localizedTotal}
            </span>
          ) : hasFixedPrice ? (
            <>
              <span
                className={cn(
                  "font-bold tracking-tight text-foreground",
                  compact ? "text-3xl" : "text-5xl",
                )}
              >
                <NumberFlow
                  value={shownPrice}
                  format={{
                    style: "currency",
                    currency: "USD",
                    minimumFractionDigits: 0,
                  }}
                />
              </span>
              {plan.period && (
                <span className="text-sm font-semibold leading-6 tracking-wide text-muted-foreground">
                  / {plan.period}
                </span>
              )}
            </>
          ) : (
            <span className="text-3xl font-bold tracking-tight text-foreground">
              {plan.price}
            </span>
          )}
        </div>
        {hasFixedPrice && (
          <p className="mt-2 text-xs text-muted-foreground">
            {isMonthly ? "Billed Monthly" : "Billed Annually"}
          </p>
        )}

        <ul
          role="list"
          className={cn(
            "text-left text-muted-foreground",
            compact ? "mt-4 space-y-1 text-xs leading-[18px]" : "mt-8 space-y-3 text-sm leading-6",
          )}
        >
          {plan.features.map((feature) => (
            <li key={feature} className="flex gap-x-3">
              <Check
                className="h-6 w-5 flex-none text-accent"
                aria-hidden="true"
              />
              {feature}
            </li>
          ))}
        </ul>

        <div className={cn("mt-auto", compact ? "pt-4" : "pt-8")}>
          {onSelect && plan.tier ? (
            <button
              type="button"
              onClick={() => onSelect(plan, isMonthly)}
              disabled={isDisabledPlan}
              className={cn(
                buttonVariants({
                  variant: plan.isPopular ? "default" : "outline",
                  size: compact ? "sm" : "lg",
                }),
                "w-full",
                isDisabledPlan && "cursor-default opacity-60",
              )}
            >
              {buttonLabel}
            </button>
          ) : (
            <a
              href={plan.href}
              className={cn(
                buttonVariants({
                  variant: plan.isPopular ? "default" : "outline",
                  size: compact ? "sm" : "lg",
                }),
                "w-full",
              )}
            >
              {plan.buttonText}
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}