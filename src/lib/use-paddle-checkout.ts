"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPaddleCheckoutBinding, getPaddleEnv } from "@/lib/account.functions";

// Loads Paddle.js (lazily, once) and opens the hosted checkout as a one-page
// overlay for the exact price shown on the pricing page. The client token is
// public by design; environment (sandbox/live) comes from the server.

type PaddleEnv = {
  clientToken: string | null;
  environment: "sandbox" | "live";
  priceIds: {
    watchMonthly: string | null;
    watchYearly: string | null;
    adviseMonthly: string | null;
    adviseYearly: string | null;
  };
};

type PaddleEventPayload = { name: string; data?: { status?: string } };

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (env: string) => void };
      Initialize: (options: { token: string; eventCallback?: (event: PaddleEventPayload) => void }) => void;
      Checkout: {
        open: (options: {
          items: Array<{ priceId: string; quantity: number }>;
          customer?: { email: string };
          customData?: Record<string, unknown>;
          settings?: {
            displayMode: "overlay";
            variant?: "one-page" | "multi-page";
            theme?: "dark" | "light";
            successUrl?: string;
          };
        }) => void;
      };
    };
  }
}

let paddleLoadPromise: Promise<PaddleEnv> | null = null;

function injectPaddleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Paddle) return resolve();
    const existing = document.querySelector<HTMLScriptElement>('script[src*="cdn.paddle.com/paddle"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Paddle.js failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Paddle.js failed to load"));
    document.head.appendChild(script);
  });
}

export function usePaddleCheckout(options?: {
  onSuccess?: () => void;
}): {
  ready: boolean;
  unavailable: boolean;
  error: string;
  openCheckout: (input: {
    tier: "watch" | "advise";
    cadence: "monthly" | "yearly";
    email?: string | undefined;
  }) => Promise<void>;
} {
  const fetchEnv = useServerFn(getPaddleEnv);
  const fetchCheckoutBinding = useServerFn(getPaddleCheckoutBinding);
  const [env, setEnv] = useState<PaddleEnv | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const successRef = useRef(options?.onSuccess);
  successRef.current = options?.onSuccess;

  useEffect(() => {
    let active = true;
    paddleLoadPromise ??= (async () => {
      const paddleEnv = await fetchEnv();
      if (!paddleEnv.clientToken) throw new Error("billing-not-configured");
      await injectPaddleScript();
      const Paddle = window.Paddle;
      if (!Paddle) throw new Error("Paddle.js failed to load");
      if (paddleEnv.environment !== "live") Paddle.Environment.set("sandbox");
      Paddle.Initialize({
        token: paddleEnv.clientToken,
        eventCallback: (event) => {
          if (event.name === "checkout.completed") successRef.current?.();
        },
      });
      return paddleEnv;
    })();
    paddleLoadPromise
      .then((paddleEnv) => {
        if (!active) return;
        setEnv(paddleEnv);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error && err.message === "billing-not-configured"
          ? "Billing is not set up yet."
          : "Could not load checkout. Please try again.");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCheckout = useCallback(
    async (input: { tier: "watch" | "advise"; cadence: "monthly" | "yearly"; email?: string | undefined }) => {
      if (!env) return;
      const priceId =
        input.tier === "watch"
          ? input.cadence === "monthly"
            ? env.priceIds.watchMonthly
            : env.priceIds.watchYearly
          : input.cadence === "monthly"
            ? env.priceIds.adviseMonthly
            : env.priceIds.adviseYearly;
      if (!priceId) {
        setError("This plan is not available for checkout yet.");
        return;
      }
      const identity = await fetchCheckoutBinding();
      window.Paddle?.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        ...(input.email ? { customer: { email: input.email } } : {}),
        customData: {
          user_id: identity.userId,
          user_binding: identity.binding,
          tier: input.tier,
          cadence: input.cadence,
        },
        settings: {
          displayMode: "overlay",
          variant: "one-page",
          theme: "dark",
        },
      });
    },
    [env, fetchCheckoutBinding],
  );

  return { ready, unavailable: Boolean(error), error, openCheckout };
}
