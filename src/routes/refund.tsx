import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ConstellationGrid } from "@/components/ConstellationGrid";
import { Reveal } from "@/components/Reveal";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [
      { title: "Refund policy — theBizScope" },
      {
        name: "description",
        content: "How refunds work for theBizScope subscriptions — case-by-case within 30 days of a payment.",
      },
    ],
  }),
  component: RefundPage,
});

const SECTIONS: Array<[string, ReactNode]> = [
  [
    "The short version",
    "Every subscription can be cancelled at any time, and if a payment didn't earn its keep, we want it back in your hands. Requests made within 30 days of a payment are considered case by case — we'd rather refund someone honest than make it hard for you.",
  ],
  [
    "The 30-day window",
    "You can ask for a refund within 30 days of any payment — the first one or any renewal. One request per payment; the window runs from the date the payment was charged, not the date you noticed it.",
  ],
  [
    "How we decide",
    [
      "We look at each request in context. Things that weigh in your favour:",
      <ul key="factors" className="mt-2 list-disc space-y-1 pl-5">
        <li>An early payment on a subscription you barely used.</li>
        <li>The service was unavailable or clearly not delivering what was described.</li>
        <li>You were charged after cancelling, or charged the wrong amount.</li>
        <li>A duplicate payment or an honest mistake — yours or ours.</li>
      </ul>,
      "Things that weigh against: heavy use of the monitoring and briefs across the period, a pattern of repeated refund requests, or requests well outside the window.",
    ],
  ],
  [
    "How to request one",
    [
      "Email ",
      <a key="mail" className="underline decoration-rule underline-offset-2 hover:text-foreground" href="mailto:hello@thebizscope.app?subject=Refund%20request">
        hello@thebizscope.app
      </a>,
      " with the email on your account and the date of the payment. We reply within 5 business days with a decision — usually sooner. We never ask for card details; the payment reference is enough.",
    ],
  ],
  [
    "How refunds are paid",
    "theBizScope sells through Paddle, who act as merchant of record for every payment. Approved refunds are issued by Paddle to your original payment method, and typically appear within 5–10 business days depending on your bank or card issuer.",
  ],
  [
    "Cancelling is not a refund",
    "Cancelling from the customer portal stops all future payments immediately, and your plan stays active until the end of the period you've paid for. If you want money from a recent payment back as well, ask within the 30-day window — cancellation alone doesn't trigger a refund of time already purchased.",
  ],
  [
    "Your statutory rights",
    "Nothing in this policy limits any rights you have under mandatory consumer law — including statutory withdrawal or remedy rights that may apply in your country. Where this policy and the law disagree, the law wins.",
  ],
  [
    "Chargebacks",
    "Please talk to us before disputing a charge with your bank — a refund request is nearly always faster and never puts your account on hold. We review every dispute against our records, and we contest chargebacks where the service was delivered as described.",
  ],
  [
    "Contact",
    [
      "Questions about refunds? Email ",
      <a key="mail2" className="underline decoration-rule underline-offset-2 hover:text-foreground" href="mailto:hello@thebizscope.app">
        hello@thebizscope.app
      </a>,
      " and we'll get back to you.",
    ],
  ],
];

function RefundPage() {
  return (
    <main className="theme-dark relative min-h-screen">
      <ConstellationGrid className="fixed inset-0 h-screen w-full" />
      <div className="relative mx-auto max-w-3xl px-6 py-16 md:py-24">
        <div className="rule-double pt-6">
          <p className="eyebrow animate-fade">theBizScope</p>
          <h1 className="animate-rise mt-4 text-4xl leading-tight md:text-5xl font-serif [animation-delay:80ms]">
            Refund policy
          </h1>
          <p className="animate-fade mt-4 text-sm text-muted-foreground [animation-delay:200ms]">
            Last updated: September 2026
          </p>
        </div>
        <div className="mt-10 space-y-8">
          {SECTIONS.map(([title, body]) => (
            <Reveal key={typeof title === "string" ? title : "section"} seqIndex={0} seqPx={80}>
              <section>
                <h2 className="font-serif text-2xl">{title}</h2>
                <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
                  {Array.isArray(body) ? body : <p>{body}</p>}
                </div>
              </section>
            </Reveal>
          ))}
        </div>
        <p className="mt-12 border-t border-rule pt-6 text-xs text-muted-foreground">
          See also our{" "}
          <Link to="/terms" className="underline decoration-rule underline-offset-2 hover:text-foreground">
            Terms
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline decoration-rule underline-offset-2 hover:text-foreground">
            Privacy policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
