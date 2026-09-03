import { createFileRoute, Link } from "@tanstack/react-router";
import { WaitlistForm } from "@/components/WaitlistForm";
import { BriefCard, type Signal } from "@/components/BriefCard";
import { SampleBriefGenerator } from "@/components/SampleBriefGenerator";
import { AuthNavLink } from "@/components/AuthNavLink";
import { Reveal } from "@/components/Reveal";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Localscope — Weekly market briefs for salons & spas" },
      {
        name: "description",
        content:
          "AI that watches your local salon market — competitor prices, reviews, new openings — and tells you what changed, why it matters, and what to do.",
      },
      { property: "og:title", content: "Localscope — Weekly market briefs for salons & spas" },
      {
        property: "og:description",
        content: "We watch your local market for you and tell you what you need to know. Built for salon & spa owners.",
      },
      { property: "og:type", content: "website" },
      // TODO: swap to an absolute URL (https://your-domain/og.png) once the production domain is known.
      { property: "og:image", content: "/og.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const SIGNALS: Signal[] = [
  {
    tone: "red",
    label: "Price move",
    headline: "Glow Studio dropped haircut prices by 15%",
    detail: "$60 → $51 for women's cuts, listed on Google and Instagram since Tuesday.",
  },
  {
    tone: "amber",
    label: "New entrant",
    headline: "New salon opening 700 m away on Main Street",
    detail: "Shop board went up this week; hiring posts for 3 stylists on Instagram.",
  },
  {
    tone: "green",
    label: "Your reviews",
    headline: "Customers increasingly praise your fast service",
    detail: "“Quick” and “no waiting” mentioned in 9 of your last 14 reviews (up from 3).",
  },
];

const MONITORS = [
  ["Competitor prices & services", "Menu changes, new treatments, package deals"],
  ["Promotions & offers", "Seasonal discounts, first-visit deals, combo pricing"],
  ["Reviews & sentiment", "What customers praise or complain about — yours and theirs"],
  ["New openings & closures", "Salons arriving, expanding, or shutting nearby"],
  ["Social & web activity", "Instagram posts, website updates, hiring signals"],
  ["Neighbourhood changes", "New apartments, offices, and footfall drivers"],
];

const STEPS = [
  ["Tell us where you are", "Your salon's location and the 3–10 competitors you care about. Or let us find them."],
  ["We watch, every day", "AI scans public listings, reviews, websites and social pages so you don't have to."],
  ["You get a brief, every Monday", "Three signals, one recommendation. Read it in two minutes on WhatsApp or email."],
];

const PLANS = [
  {
    name: "Watch",
    price: "$15",
    period: "/mo",
    blurb: "Weekly brief for one location, up to 5 competitors.",
    items: ["Weekly Market Brief", "Prices, promotions & hours", "Review sentiment summary"],
    cta: "Join waitlist",
  },
  {
    name: "Advise",
    price: "$50",
    period: "/mo",
    blurb: "Deeper intelligence plus recommendations you can act on.",
    items: ["Everything in Watch", "Up to 15 competitors", "New openings & closures", "Actionable recommendations", "Instant alerts on big moves"],
    featured: true,
    cta: "Join waitlist",
  },
  {
    name: "Expand",
    price: "Ask for a quote",
    period: "",
    blurb: "Multi-location owners and those planning the next branch.",
    items: ["Everything in Advise", "Multiple locations", "Neighbourhood development tracking", "Next-location recommendations"],
    cta: "Ask for a quote",
  },
];

function Index() {
  return (
    <main className="min-h-screen">
      {/* Masthead */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <a href="#" className="font-serif text-2xl tracking-tight">
          Localscope<span className="text-accent">.</span>
        </a>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground sm:flex">
          <a href="#brief" className="hover:text-foreground">Sample brief</a>
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#pricing" className="hover:text-foreground">Pricing</a>
          <a href="#try" className="hover:text-foreground">Try it</a>
        </nav>
        <div className="flex items-center gap-5">
          <AuthNavLink />
          <a
            href="#waitlist"
            className="rounded-sm border border-ink px-4 py-2 text-sm font-medium transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Get early access
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-10 md:pt-20">
        <div className="rule-double pt-6">
          <p className="eyebrow animate-fade">For salon & spa owners · Anywhere in the world</p>
          <h1 className="mt-6 max-w-4xl text-5xl leading-[1.02] md:text-7xl animate-rise">
            We watch your local market. <em className="text-accent">You</em> just read the brief.
          </h1>
          <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground animate-rise [animation-delay:120ms]">
            Localscope continuously monitors competitors, reviews, and neighbourhood changes around your salon — then
            tells you what changed, why it matters, and what to do about it. Every Monday, in two minutes.
          </p>
          <div className="mt-10 max-w-xl animate-rise [animation-delay:220ms]">
            <WaitlistForm compact />
          </div>
        </div>
      </section>

      {/* Sample brief */}
      <section id="brief" className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:items-start">
          <Reveal className="lg:sticky lg:top-10">
            <p className="eyebrow">What you get</p>
            <h2 className="mt-4 text-4xl leading-tight md:text-5xl">Not a dashboard. A brief.</h2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              Owners don't have time to study charts. Each week you get the three things that changed around you, ranked
              by how much they matter, and one clear recommendation.
            </p>
            <ul className="mt-8 space-y-3 text-sm">
              {[
                ["bg-signal-red", "Red — act this week"],
                ["bg-signal-amber", "Amber — keep an eye on it"],
                ["bg-signal-green", "Green — something to lean into"],
              ].map(([dot, text]) => (
                <li key={text} className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                  <span className="text-muted-foreground">{text}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delayMs={140}>
          <BriefCard
            title="Radiance Salon, Riverside"
            dateLabel="Week of 31 Aug"
            signals={SIGNALS}
            recommendation="Test a weekday promotion to blunt Glow Studio's price cut — and put “in and out in 40 minutes” at the front of your Instagram bio and Google profile."
            why="your weekday afternoons are the slot most exposed to a cheaper competitor, and speed is the strength customers already notice."
          />
          </Reveal>
        </div>
      </section>

      {/* What we monitor */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <Reveal className="rule-top pt-8">
          <p className="eyebrow">What we monitor</p>
          <h2 className="mt-4 max-w-2xl text-4xl leading-tight md:text-5xl">Everything happening within walking distance of your door.</h2>
        </Reveal>
        <dl className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {MONITORS.map(([title, desc], i) => (
            <Reveal key={title} delayMs={i * 60} className="border-t border-rule pt-4">
              <dt className="flex items-baseline gap-3 font-serif text-xl">
                <span className="text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                {title}
              </dt>
              <dd className="mt-2 text-sm text-muted-foreground leading-relaxed">{desc}</dd>
            </Reveal>
          ))}
        </dl>
      </section>

      {/* How it works */}
      <section id="how" className="bg-paper-deep/70 border-y border-rule">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <p className="eyebrow">How it works</p>
            <h2 className="mt-4 text-4xl leading-tight md:text-5xl">Set up once. Read every Monday.</h2>
          </Reveal>
          <ol className="mt-12 grid gap-10 md:grid-cols-3">
            {STEPS.map(([title, desc], i) => (
              <li key={title}>
                <Reveal delayMs={i * 100} className="h-full">
                <span className="font-serif text-6xl text-accent">{i + 1}</span>
                <h3 className="mt-3 font-serif text-2xl">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
        <Reveal>
          <p className="eyebrow">Pricing</p>
          <h2 className="mt-4 text-4xl leading-tight md:text-5xl">Less than one lost regular customer.</h2>
          <p className="mt-4 max-w-xl text-muted-foreground">Per month, per location. Early-access members lock in launch pricing for 12 months.</p>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delayMs={i * 90} className="h-full">
            <div
              className={`paper-card flex h-full flex-col rounded-md p-7 ${p.featured ? "border-ink shadow-lift md:-translate-y-3" : ""}`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="font-serif text-2xl">{p.name}</h3>
                {p.featured && <span className="eyebrow text-accent">Most popular</span>}
              </div>
              <p className={`mt-4 font-serif ${p.period ? "text-5xl" : "text-3xl leading-[1.35]"}`}>
                {p.price}
                {p.period && <span className="ml-1 font-sans text-sm text-muted-foreground">{p.period}</span>}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">{p.blurb}</p>
              <ul className="mt-6 space-y-2 border-t border-rule pt-5 text-sm">
                {p.items.map((it) => (
                  <li key={it} className="flex gap-2">
                    <span className="text-accent">—</span>
                    {it}
                  </li>
                ))}
              </ul>
              <a
                href="#waitlist"
                className={`mt-auto pt-8 inline-block text-center text-sm font-medium`}
              >
                <span
                  className={`inline-block w-full rounded-sm px-4 py-2.5 transition-colors ${
                    p.featured
                      ? "bg-primary text-primary-foreground hover:bg-accent"
                      : "border border-ink hover:bg-primary hover:text-primary-foreground"
                  }`}
                >
                  {p.cta}
                </span>
              </a>
            </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Generate sample brief */}
      <section id="try" className="bg-paper-deep/70 border-y border-rule">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <SampleBriefGenerator />
          </Reveal>
        </div>
      </section>

      {/* Waitlist */}
      <section id="waitlist" className="mx-auto max-w-6xl px-6 py-20">
        <Reveal>
        <div className="rule-double grid gap-10 pt-10 lg:grid-cols-2">
          <div>
            <p className="eyebrow">Early access</p>
            <h2 className="mt-4 text-4xl leading-tight md:text-5xl">Get your first brief free.</h2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              We're onboarding salons and spas city by city. Join the list and we'll send a sample brief for your own
              neighbourhood before you pay a cent.
            </p>
          </div>
          <div className="paper-card rounded-md p-7">
            <WaitlistForm />
          </div>
        </div>
        </Reveal>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col gap-3 border-t border-rule px-6 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 Localscope. AI market research for local businesses.</p>
        <div className="flex items-center gap-5">
          <Link to="/privacy" className="underline decoration-rule underline-offset-2 hover:text-foreground">
            Privacy
          </Link>
          <Link to="/terms" className="underline decoration-rule underline-offset-2 hover:text-foreground">
            Terms
          </Link>
          <p>Starting with salons & spas. More verticals soon.</p>
        </div>
      </footer>
    </main>
  );
}
