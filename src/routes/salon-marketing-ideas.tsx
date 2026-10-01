import { createFileRoute, Link } from "@tanstack/react-router";
import { ConstellationGrid } from "@/components/ConstellationGrid";
import { Reveal } from "@/components/Reveal";

const TITLE = "Salon Marketing Ideas Built on Local Market Signals — theBizScope";
const DESCRIPTION =
  "Practical salon marketing ideas using competitor prices, local reviews, promotions, and neighbourhood changes.";

export const Route = createFileRoute("/salon-marketing-ideas")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://thebizscope.com/salon-marketing-ideas" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://thebizscope.com/salon-marketing-ideas" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "Salon marketing ideas built on local market signals",
          description: DESCRIPTION,
          publisher: { "@type": "Organization", name: "theBizScope", url: "https://thebizscope.com" },
        }),
      },
    ],
  }),
  component: SalonMarketingIdeas,
});

const IDEAS = [
  {
    number: "01",
    title: "Turn review language into your message",
    signal: "Customers repeatedly praise a specific strength, such as fast service, careful consultations, or lasting colour.",
    action: "Use their exact recurring theme in your Google profile, booking page, and next three social posts. It is evidence-backed positioning, not a slogan invented in a meeting.",
  },
  {
    number: "02",
    title: "Answer a competitor price move precisely",
    signal: "A nearby salon lowers a headline price or launches a first-visit discount.",
    action: "Avoid an automatic price cut. Promote the part of your offer their deal does not cover: consultation quality, treatment longevity, convenience, or a relevant package.",
  },
  {
    number: "03",
    title: "Build campaigns around quiet appointments",
    signal: "Your weaker booking windows overlap with a local demand pattern or a competitor promotion.",
    action: "Create a tightly timed offer for that window rather than discounting every appointment. Give it a clear audience, deadline, and booking link so you can judge the response.",
  },
  {
    number: "04",
    title: "Market the gap in nearby services",
    signal: "Competitor menus show a service customers ask for but few local salons clearly feature.",
    action: "Publish a focused service page and supporting posts that explain the result, who it suits, the price, and how to book. Make the local point of difference explicit.",
  },
  {
    number: "05",
    title: "Use neighbourhood change before it becomes obvious",
    signal: "New homes, offices, transport links, or businesses are opening nearby.",
    action: "Plan a local welcome campaign before opening week. Partner with a complementary neighbour, prepare a location-specific offer, and update map listings so newcomers can find you.",
  },
  {
    number: "06",
    title: "Respond to a review weakness with proof",
    signal: "Recent reviews repeatedly mention waiting, unclear prices, or difficulty booking.",
    action: "Fix the experience first, then market the change with specifics. A post about clearer pricing or a simpler booking process is stronger when the operational change is already real.",
  },
];

function SalonMarketingIdeas() {
  return (
    <main className="theme-dark relative min-h-screen">
      <ConstellationGrid className="fixed inset-0 h-screen w-full" />
      <div className="relative mx-auto max-w-5xl px-6 py-10 md:py-16">
        <nav className="flex items-center justify-between border-b border-rule pb-5" aria-label="Primary navigation">
          <Link to="/" className="font-serif text-2xl">theBizScope<span className="text-accent">.</span></Link>
          <Link to="/pricing" className="text-sm underline decoration-rule underline-offset-4 hover:text-accent">Pricing</Link>
        </nav>

        <article>
          <header className="rule-double mt-14 pb-14 pt-8 md:mt-20 md:pb-20">
            <p className="eyebrow">Field guide · Salon growth</p>
            <h1 className="mt-5 max-w-4xl text-5xl leading-[1.02] md:text-7xl">
              Salon marketing ideas built on what is changing around you
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              The strongest salon marketing is not a list of random posts. It starts with a local signal, turns that signal into a clear response, and gives customers a reason to act.
            </p>
          </header>

          <section className="border-y border-rule bg-paper-deep/70 py-10">
            <div className="grid gap-8 md:grid-cols-[0.8fr_1.2fr]">
              <h2 className="text-3xl leading-tight md:text-4xl">A simple signal-to-action method</h2>
              <div className="space-y-4 leading-relaxed text-muted-foreground">
                <p><strong className="text-foreground">Observe:</strong> identify a concrete change in competitor pricing, local reviews, demand, or the neighbourhood.</p>
                <p><strong className="text-foreground">Interpret:</strong> decide which customers and appointment times it could affect.</p>
                <p><strong className="text-foreground">Act:</strong> choose one measurable response with a clear audience, message, channel, and time frame.</p>
              </div>
            </div>
          </section>

          <section className="py-16 md:py-20">
            <p className="eyebrow">Six practical plays</p>
            <div className="mt-8 divide-y divide-rule border-y border-rule">
              {IDEAS.map((idea, index) => (
                <Reveal key={idea.number} delayMs={index * 50}>
                  <section className="grid gap-5 py-9 md:grid-cols-[5rem_1fr_1fr] md:gap-8">
                    <span className="font-serif text-4xl text-accent">{idea.number}</span>
                    <div>
                      <h2 className="text-2xl leading-tight">{idea.title}</h2>
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground"><strong className="text-foreground">Signal:</strong> {idea.signal}</p>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground"><strong className="text-foreground">Marketing action:</strong> {idea.action}</p>
                  </section>
                </Reveal>
              ))}
            </div>
          </section>

          <section className="rule-double grid gap-8 py-12 md:grid-cols-2 md:items-center">
            <div>
              <p className="eyebrow">Make it a weekly habit</p>
              <h2 className="mt-4 text-4xl leading-tight">One signal. One decision. One measurable action.</h2>
            </div>
            <div>
              <p className="leading-relaxed text-muted-foreground">theBizScope monitors competitor prices, reviews, openings, promotions, and neighbourhood changes, then turns the most important movement into a short weekly brief.</p>
              <Link to="/signup" className="mt-6 inline-flex rounded-sm bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent">Start watching your market</Link>
            </div>
          </section>
        </article>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-rule py-8 text-xs text-muted-foreground">
          <p>© 2026 theBizScope.</p>
          <div className="flex gap-5">
            <Link to="/privacy" className="underline decoration-rule underline-offset-2 hover:text-foreground">Privacy</Link>
            <Link to="/terms" className="underline decoration-rule underline-offset-2 hover:text-foreground">Terms</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}