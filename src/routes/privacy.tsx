import { createFileRoute, Link } from "@tanstack/react-router";
import { ConstellationGrid } from "@/components/ConstellationGrid";
import { Reveal } from "@/components/Reveal";

export const Route = createFileRoute("/privacy")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "Privacy — theBizScope" },
      {
        name: "description",
        content: "How theBizScope collects, uses, and protects your data.",
      },
    ],
  }),
  component: PrivacyPage,
});

const SECTIONS: Array<[string, string]> = [
  [
    "Who we are",
    "theBizScope watches the local market around small businesses and turns what it finds into plain-English briefs. That's who \"we\" means in this policy. Reach us any time at support@thebizscope.com.",
  ],
  [
    "What we collect",
    "When you create an account we store your email address and the details of the business you want watched: its name, location, business type, and any contact details you add. To do the monitoring we also store what we find — snapshots of public information about competitors near you, like names, prices, ratings, review counts, and openings or closures. When you generate a sample brief without an account, the inputs you type are used to run the research and aren't attached to a profile.",
  ],
  [
    "Why we collect it",
    "To run the service you signed up for: build your briefs, watch for changes, and email you what we found. We look at aggregate usage to decide what to build next. We don't profile you for advertising and we don't sell your data.",
  ],
  [
    "Payments & subscriptions",
    "Subscriptions are sold through Paddle (paddle.com), our merchant of record. Paddle runs the checkout, stores your payment details, and collects the VAT or sales tax for your country — we never see your full card details. From Paddle we receive your customer reference, billing email, the plan you bought, and its status (active, past due, cancelled) so we can grant and maintain your access. Paddle's own privacy policy governs the payment data it holds. Billing records are kept for as long as tax and accounting law requires. Refunds work as described in our Refund policy.",
  ],
  [
    "AI processing",
    "Briefs are drafted with the help of an AI language model. We send it the research we've gathered — business names, prices, ratings, and short review snippets from public sources — and it writes the plain-English summary you read. We don't send it your account details.",
  ],
  [
    "Research sources",
    "Briefs are built from public and licensed sources — Google Places, OpenStreetMap, Foursquare, Geoapify, Overture Maps, and publicly accessible business websites. Those sources operate under their own terms and privacy policies, which we don't control. When a brief makes a claim, the link next to it points at the public page we saw.",
  ],
  [
    "Emails we send",
    "Paid subscribers get the weekly brief and, where the plan includes them, immediate alerts — those are part of the service. We occasionally send product updates too. Every email tells you how to stop getting them, and unsubscribing always works.",
  ],
  [
    "What we don't do",
    "We don't sell or rent your personal information. We don't share it with third parties for their own marketing. We don't use your data to advertise to you beyond the theBizScope service itself.",
  ],
  [
    "Cookies & local storage",
    "We don't run advertising trackers or third-party analytics. Your browser stores a few of our interface preferences locally — like which dashboard view you prefer — and the session that keeps you signed in.",
  ],
  [
    "Retention & deletion",
    "We keep your account, business, and monitoring history while your account is active. To delete it, email us from your account address and we'll remove your profile, businesses, and snapshots within 30 days. Waitlist details are kept until you ask us to remove them. Anything Paddle holds for billing purposes is kept per tax law, as described above.",
  ],
  [
    "Security",
    "Your data lives with our infrastructure providers (Lovable and Supabase) and is encrypted in transit and at rest. Access on our side is limited to what's needed to run the service. No system is perfectly secure, but if a breach affects you we'll tell you promptly and plainly.",
  ],
  [
    "Contact",
    "Questions about this policy? Email us at support@thebizscope.com and we'll get back to you.",
  ],
];

function PrivacyPage() {
  return (
    <main className="theme-dark relative min-h-screen">
      <ConstellationGrid className="fixed inset-0 h-screen w-full" />
      <div className="relative mx-auto max-w-3xl px-6 py-16 md:py-24">
        <div className="rule-double pt-6">
          <p className="eyebrow animate-fade">theBizScope</p>
          <h1 className="animate-rise mt-4 text-4xl leading-tight md:text-5xl font-serif [animation-delay:80ms]">
            Privacy
          </h1>
          <p className="animate-fade mt-4 text-sm text-muted-foreground [animation-delay:200ms]">
            Last updated: September 2026
          </p>
        </div>
        <div className="mt-10 space-y-8">
          {SECTIONS.map(([title, body]) => (
            <Reveal key={title} seqIndex={0} seqPx={80}>
              <section>
                <h2 className="font-serif text-2xl">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </section>
            </Reveal>
          ))}
        </div>
        <p className="mt-12 border-t border-rule pt-6 text-xs text-muted-foreground">
          This is a plain-English summary of how theBizScope handles your data. If anything here conflicts with the
          commitments we make in writing to you, the specific commitment wins. See also our{" "}
          <Link to="/terms" className="underline decoration-rule underline-offset-2 hover:text-foreground">
            Terms
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
