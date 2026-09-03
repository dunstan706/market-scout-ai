import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy — Localscope" },
      {
        name: "description",
        content: "How Localscope collects, uses, and protects your data.",
      },
    ],
  }),
  component: PrivacyPage,
});

const SECTIONS: Array<[string, string]> = [
  [
    "What we collect",
    "When you join the waitlist we store the email address you give us, plus the optional business name, city, and business type you provide. When you generate a sample brief we process the business name, location, and business type you type in — those inputs are used to run the live research and are not saved to your profile.",
  ],
  [
    "Why we collect it",
    "We use your email to send your sample brief, to tell you when your city opens, and to share product updates. We use the optional business details only to understand who our early users are and to tailor what we send.",
  ],
  [
    "What we don't do",
    "We don't sell or rent your personal information. We don't share it with third parties for their own marketing. We don't use your data to advertise to you beyond the Localscope service itself.",
  ],
  [
    "Research sources",
    "Sample briefs are generated from public sources — Google Places, OpenStreetMap, and publicly accessible business websites. Those sources operate under their own terms and privacy policies, which we don't control.",
  ],
  [
    "Retention & deletion",
    "We keep waitlist signups until you ask us to remove them or the waitlist is retired. To delete your details, email us with the address you signed up with and we'll remove it within 30 days.",
  ],
  [
    "Contact",
    "Questions about this policy? Email us at privacy@localscope.app and we'll get back to you.",
  ],
];

function PrivacyPage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <div className="rule-double pt-6">
          <p className="eyebrow">Localscope</p>
          <h1 className="mt-4 text-4xl leading-tight md:text-5xl font-serif">Privacy</h1>
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
          This is a plain-English summary of how Localscope handles your data. If anything here conflicts with the
          commitments we make in writing to you, the specific commitment wins.
        </p>
      </div>
    </main>
  );
}