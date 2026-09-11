import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ConstellationGrid } from "@/components/ConstellationGrid";
import { Reveal } from "@/components/Reveal";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms — theBizScope" },
      {
        name: "description",
        content: "The terms that apply when you use theBizScope.",
      },
    ],
  }),
  component: TermsPage,
});

const SECTIONS: Array<[string, ReactNode]> = [
  [
    "Who we are",
    "theBizScope is a market-monitoring service for small local businesses (\"theBizScope\", \"we\", \"us\"). By creating an account or using the service, you agree to these terms. If you use theBizScope on behalf of a business, you confirm you're allowed to accept these terms for it.",
  ],
  [
    "The service",
    "theBizScope continuously watches public information about the businesses around yours — competitors' prices, reviews, openings, closures, and other neighbourhood signals — and turns it into plain-English briefs, delivered weekly to paid subscribers, with faster alerts on plans that include them. The sample-brief generator is a free demo so you can see what a weekly brief looks like before paying.",
  ],
  [
    "Accounts",
    "Keep your login details safe — you're responsible for what happens through your account. Give us accurate business details; the service depends on watching the right market. Plans include a set number of business locations (one on Watch, five on Advise, more by arrangement on Expand), and you may not resell or share access.",
  ],
  [
    "Subscriptions & billing",
    [
      "Paid plans are billed monthly or yearly and renew automatically until cancelled. Checkout and payment are handled by Paddle (paddle.com), our merchant of record — they collect your payment and the VAT or sales tax for your country, and we never see your full card details.",
      "You can cancel any time from your customer portal, and your plan stays active until the end of the period you've paid for. We won't reduce features mid-period or raise your price without at least 30 days' notice by email.",
    ],
  ],
  [
    "Refunds",
    "Refunds are handled case by case within 30 days of any payment — see our Refund policy for how it works. Nothing here takes away rights the law gives you.",
  ],
  [
    "Fair use",
    "The sample-brief generator costs real money to run. Please use it for genuine evaluation, not automated or repeated bulk requests. We rate-limit the generator and may suspend accounts or IPs that abuse it. Don't scrape, probe, or try to disrupt the service or use it to build a competing data product.",
  ],
  [
    "What briefs are — and aren't",
    "Briefs are informational only. They're compiled from public sources that may be incomplete, out of date, or wrong, and they're not business, financial, or legal advice. Every claim links to the public page it came from — check anything that matters before acting on it. Don't make business decisions solely on the basis of a brief.",
  ],
  [
    "Your data and ours",
    [
      "Your business information stays yours; you're just letting us use it to run the service. How we handle personal data is set out in our Privacy policy.",
      "The theBizScope platform, the way briefs are compiled, and the wording we generate belong to us. You may use briefs freely inside your business — posting a recommendation on your Instagram or quoting it to your staff is exactly the point — but you can't republish briefs wholesale or resell them as data.",
    ],
  ],
  [
    "Service availability",
    "We work hard to keep the service running, but it's provided as-is and we can't promise it'll be uninterrupted or error-free. Public sources change without warning, and some features are new — we may adjust or retire features as the product grows. If we ever discontinue the service entirely, we'll give active subscribers at least 30 days' notice and refund the unused portion of any prepaid period.",
  ],
  [
    "Suspension",
    "We may suspend or end an account that breaks these terms — abuse of the generator, non-payment, or misuse of the data — with a note explaining why where that's possible.",
  ],
  [
    "Limitation of liability",
    "To the maximum extent permitted by law, theBizScope is provided \"as is\" without warranties of any kind, and we aren't liable for any indirect or consequential loss arising from your use of the service, including decisions you make based on a brief. Our total liability for any claim is capped at what you paid us in the 12 months before it arose.",
  ],
  [
    "Changes to these terms",
    "We may update these terms as the service evolves. For material changes we'll email active subscribers at least 14 days ahead. Continuing to use theBizScope after a change takes effect means you accept the updated terms.",
  ],
  [
    "Governing law",
    "These terms are governed by the laws of the country in which theBizScope is established, without regard to its conflict-of-law rules. Nothing here stops you from using mandatory consumer rights where you live.",
  ],
  [
    "Contact",
    "Questions about these terms? Email us at hello@thebizscope.com.",
  ],
];

function TermsPage() {
  return (
    <main className="theme-dark relative min-h-screen">
      <ConstellationGrid className="fixed inset-0 h-screen w-full" />
      <div className="relative mx-auto max-w-3xl px-6 py-16 md:py-24">
        <div className="rule-double pt-6">
          <p className="eyebrow animate-fade">theBizScope</p>
          <h1 className="animate-rise mt-4 text-4xl leading-tight md:text-5xl font-serif [animation-delay:80ms]">
            Terms
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
          <Link to="/privacy" className="underline decoration-rule underline-offset-2 hover:text-foreground">
            Privacy policy
          </Link>{" "}
          and{" "}
          <Link to="/refund" className="underline decoration-rule underline-offset-2 hover:text-foreground">
            Refund policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
