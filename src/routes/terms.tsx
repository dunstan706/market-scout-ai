import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms — Localscope" },
      {
        name: "description",
        content: "The terms that apply when you use Localscope.",
      },
    ],
  }),
  component: TermsPage,
});

const SECTIONS: Array<[string, string]> = [
  [
    "The service",
    "Localscope generates market briefs for local businesses using publicly available sources. The brief generator is provided as a free demo so you can see what a weekly brief looks like for your neighbourhood.",
  ],
  [
    "No guarantee of accuracy",
    "Briefs are compiled from third-party public sources — directories, websites, and reviews — that may be incomplete, out of date, or wrong. We work hard to only claim what the evidence supports and to say when something is unavailable, but the briefs are informational only. Don't make business decisions solely on the basis of a brief; verify anything that matters before acting on it.",
  ],
  [
    "Fair use",
    "The sample-brief generator costs real money to run. Please use it for genuine evaluation, not automated or repeated bulk requests. We rate-limit the generator and may block accounts or IPs that abuse it.",
  ],
  [
    "Pricing",
    "Plans and prices shown on the site are indicative and may change. Early-access members who join the waitlist may be offered launch pricing for a fixed period, as described when that offer is made.",
  ],
  [
    "Your data",
    "Your business and personal data belongs to you. We collect only what's needed to run the service, as described in our Privacy policy. We don't claim ownership of your business information.",
  ],
  [
    "Limitation of liability",
    "To the maximum extent permitted by law, Localscope is provided “as is” without warranties of any kind, and we aren't liable for any indirect or consequential loss arising from your use of the service, including decisions you make based on a brief.",
  ],
  [
    "Contact",
    "Questions about these terms? Email us at hello@localscope.app.",
  ],
];

function TermsPage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <div className="rule-double pt-6">
          <p className="eyebrow">Localscope</p>
          <h1 className="mt-4 text-4xl leading-tight md:text-5xl font-serif">Terms</h1>
          <p className="mt-4 text-sm text-muted-foreground">Last updated: September 2026</p>
        </div>
        <div className="mt-10 space-y-8">
          {SECTIONS.map(([title, body]) => (
            <section key={title}>
              <h2 className="font-serif text-2xl">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </section>
          ))}
        </div>
        <p className="mt-12 border-t border-rule pt-6 text-xs text-muted-foreground">
          These terms are a working draft for an early-stage service. They'll be reviewed and tightened before launch.
        </p>
      </div>
    </main>
  );
}