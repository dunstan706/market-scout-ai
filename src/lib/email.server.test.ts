import { describe, expect, it, vi, afterEach } from "vitest";
import { renderBriefEmail, renderMarketAlert, sendEmail } from "@/lib/email.server";

const SAMPLE = {
  title: "Radiance Salon, Shoreditch, London",
  signals: [
    { tone: "red" as const, label: "Price move", headline: 'Glow Studio cut "haircuts" to $40', detail: "Old price $60 · 500 m away" },
    { tone: "amber" as const, label: "New in area", headline: "Luxe Cuts first appeared in our scans", detail: "300 m from you" },
    { tone: "green" as const, label: "Your business", headline: "Your rating rose to 4.6/5", detail: "Up from 4.5" },
  ],
  recommendation: "Test a weekday promotion to blunt Glow Studio's price cut.",
  why: "Weekday afternoons are the slot most exposed to a cheaper competitor.",
  sources: [{ label: "Google Places", url: "https://maps.google.com/" }],
  dashboardUrl: "https://example.com/dashboard",
};

function sampleOverrides(partial: Partial<typeof SAMPLE> & { intro?: string; outro?: string } = {}) {
  return { ...SAMPLE, ...partial };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("renderBriefEmail — weekly digest", () => {
  it("builds a subject from the brief title", () => {
    const { subject } = renderBriefEmail(sampleOverrides());
    expect(subject).toContain("Radiance Salon");
    expect(subject).toContain("brief");
  });

  it("renders every signal with its headline and detail", () => {
    const { html } = renderBriefEmail(sampleOverrides());
    expect(html).toContain("Glow Studio cut");
    expect(html).toContain("Old price $60");
    expect(html).toContain("Luxe Cuts first appeared");
    expect(html).toContain("Your rating rose to 4.6/5");
  });

  it("maps tones to their dot colours", () => {
    const { html } = renderBriefEmail(sampleOverrides());
    expect(html).toContain("background:#DC2626"); // red
    expect(html).toContain("background:#B45309"); // amber
    expect(html).toContain("background:#15803D"); // green
  });

  it("adds a ranked intro that names the signal count", () => {
    const { html, text } = renderBriefEmail(sampleOverrides({ signals: SAMPLE.signals.slice(0, 2) }));
    expect(html).toContain("2 signals worth your attention, ranked");
    expect(text).toContain("2 signals worth your attention");
  });

  it("default intro adapts when nothing changed", () => {
    const { text } = renderBriefEmail(sampleOverrides({ signals: [] }));
    expect(text).toContain("Nothing changed enough to shout about");
  });

  it("outro escalates to action when a red signal exists", () => {
    const { text } = renderBriefEmail(sampleOverrides());
    expect(text).toContain("red signal above is the one to act on");
  });

  it("outro is calm when nothing is red", () => {
    const calm = SAMPLE.signals.filter((s) => s.tone !== "red");
    const { text } = renderBriefEmail(sampleOverrides({ signals: calm }));
    expect(text).toContain("Nothing's on fire this week");
  });

  it("honours custom intro/outro overrides", () => {
    const { text } = renderBriefEmail(
      sampleOverrides({ intro: "Morning Radiance.", outro: "Talk soon." }),
    );
    expect(text).toContain("Morning Radiance.");
    expect(text).toContain("Talk soon.");
  });

  it("signs off with the brand tagline", () => {
    const { html, text } = renderBriefEmail(sampleOverrides());
    expect(html).toContain("We watch your local market. You just read the brief.");
    expect(text).toContain("We watch your local market. You just read the brief.");
    expect(text).toContain("the Localscope team");
  });

  it("escapes HTML in titles, headlines and details", () => {
    const { html, text } = renderBriefEmail(
      sampleOverrides({
        title: "Salon <b>One</b> & Sons",
        signals: [
          {
            tone: "red",
            label: "Price",
            headline: 'Dropped to <script>alert("x")</script>$40',
            detail: "Per <i>their</i> menu & site",
          },
        ],
      }),
    );
    expect(html).not.toContain("<b>One</b>");
    expect(html).toContain("&lt;b&gt;One&lt;/b&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;i&gt;their&lt;/i&gt;");
    expect(text).toContain("Dropped to <script>alert(\"x\")</script>$40"); // plain-text stays readable
  });

  it("omits the sources block when no sources are given", () => {
    const { html } = renderBriefEmail(sampleOverrides({ sources: [] }));
    expect(html).not.toContain("Sources checked");
  });

  it("links each source and escapes its URL", () => {
    const { html } = renderBriefEmail(
      sampleOverrides({
        sources: [
          { label: "Google", url: "https://maps.google.com/?q=a&b=1" },
          { label: "OSM", url: "https://osm.org" },
        ],
      }),
    );
    expect(html).toContain("https://maps.google.com/?q=a&amp;b=1");
    expect(html).toContain("https://osm.org");
  });

  it("includes the dashboard CTA and footer", () => {
    const { html, text } = renderBriefEmail(sampleOverrides());
    expect(html).toContain("https://example.com/dashboard");
    expect(html).toContain("Open your dashboard");
    expect(text).toContain("check our work any time");
  });
});

describe("renderMarketAlert — between-brief alerts", () => {
  const base = {
    kind: "own_review" as const,
    tone: "red" as const,
    headline: "A 2-star review just landed on your listing",
    detail: '“Waited 40 minutes past my appointment.” · Google Places',
    actionLabel: "Reply on Google",
    actionUrl: "https://maps.google.com/listing",
    dashboardUrl: "https://example.com/dashboard",
    businessName: "Radiance Salon",
  };

  it("builds an urgent subject for a low own-review alert", () => {
    const { subject, html, text } = renderMarketAlert(base);
    expect(subject).toContain("Radiance Salon");
    expect(subject).toContain("low review");
    expect(html).toContain("Your business · review alert");
    expect(html).toContain("color:#DC2626"); // red tone on the eyebrow
    expect(text).toContain("Reply on Google: https://maps.google.com/listing");
  });

  it("turns a good own-review alert green and encouraging", () => {
    const { subject, html } = renderMarketAlert({ ...base, tone: "green", headline: "A 5-star review just landed on your listing" });
    expect(html).toContain("color:#15803D");
    expect(html).toContain("good review is your cheapest marketing");
    expect(subject).toContain("New review on your listing");
  });

  it("phrases competitor price cuts as a market alert", () => {
    const { subject, html } = renderMarketAlert({
      kind: "price_cut",
      tone: "red",
      headline: "Glow Studio cut its women's cut from $60 to $51",
      detail: "500 m away · Google Places",
      actionLabel: "See the change",
      actionUrl: "https://example.com/change",
      dashboardUrl: "https://example.com/dashboard",
      businessName: "Radiance Salon",
    });
    expect(subject).toContain("competitor cut a price");
    expect(html).toContain("Market · competitor price cut");
    expect(html).toContain("Glow Studio cut its women&#39;s cut");
    expect(html).toContain("Don&#39;t panic-match");
  });

  it("flags new entrants as amber watch-items", () => {
    const { html } = renderMarketAlert({
      kind: "new_entrant",
      tone: "amber",
      headline: "Luxe Cuts is opening 700 m away",
      actionLabel: "Watch it",
      actionUrl: "https://example.com",
      dashboardUrl: "https://example.com/dashboard",
    });
    expect(html).toContain("color:#B45309");
    expect(html).toContain("new business nearby");
  });

  it("escapes headline and body copy", () => {
    const { html } = renderMarketAlert({
      ...base,
      headline: 'Glow <script>Studio</script> cut prices & more',
      detail: "Source <b>bold</b>",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&amp; more");
  });

  it("mentions the business in the footer", () => {
    const { html, text } = renderMarketAlert(base);
    expect(html).toContain("watches Radiance Salon for you");
    expect(text).toContain("between your weekly briefs");
  });
});

describe("sendEmail", () => {
  it("fails cleanly without RESEND_API_KEY", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const result = await sendEmail({ to: "owner@example.com", subject: "s", html: "<p>hi</p>", text: "hi" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("RESEND_API_KEY");
  });

  it("fails cleanly without a verified RESEND_FROM", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM", "");
    const result = await sendEmail({ to: "owner@example.com", subject: "s", html: "<p>hi</p>", text: "hi" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("RESEND_FROM");
  });

  it("refuses an invalid recipient before calling the API", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM", "Localscope <briefs@example.com>");
    const result = await sendEmail({ to: "not-an-email", subject: "s", html: "<p>hi</p>", text: "hi" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("invalid email");
  });
});
