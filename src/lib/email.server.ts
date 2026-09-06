// Email variants for Localscope briefs and alerts. Delivered through the
// Resend REST API (plain fetch — no SDK dependency). Requires RESEND_API_KEY
// and RESEND_FROM (a verified sender on the Resend account, e.g.
// "Localscope <briefs@localscope.app>").
//
// Voice: the product says "We watch your local market. You just read the
// brief." Emails are plain-spoken, warm and decisive — ranked signals, one
// clear recommendation, always a next action. Red = act this week, amber =
// keep an eye on it, green = lean into it.

// --- Shared tones ---

type SignalTone = "red" | "amber" | "green";

const TONE_COLOR: Record<SignalTone, string> = {
  red: "#DC2626",
  amber: "#B45309",
  green: "#15803D",
};

// The ink-and-paper palette matches the on-site branding (cream paper, ink
// rules, amber accent).
const INK = "#2B2620";
const PAPER = "#FDFBF5";
const BACKDROP = "#F5F0E6";
const RULE = "#E7DFD0";
const MUTED = "#6B6459";
const FAINT = "#8A8378";

const TONE_WORD: Record<SignalTone, string> = {
  red: "act on",
  amber: "keep an eye on",
  green: "lean into",
};

// =====================================================================
// Variant 1 — The weekly digest
// =====================================================================

type BriefEmailInput = {
  title: string;
  signals: Array<{
    tone: SignalTone;
    label: string;
    headline: string;
    detail: string;
  }>;
  recommendation: string;
  why: string;
  sources?: Array<{ label: string; url: string }>;
  dashboardUrl: string;
  // Optional on-brand framing. Defaults read well on their own; override for
  // a more personal touch (e.g. the owner's name in the greeting).
  intro?: string;
  outro?: string;
};

function digestIntro(signals: BriefEmailInput["signals"]): string {
  const count = signals.length;
  const summary =
    count === 0
      ? "Nothing changed enough to shout about this week — the market is quiet around you."
      : `Here's what changed around you this week — ${count} ${count === 1 ? "signal" : "signals"} worth your attention, ranked by how much they matter. Read it in about two minutes.`;
  return summary;
}

function digestOutro(signals: BriefEmailInput["signals"]): string {
  const hasRed = signals.some((signal) => signal.tone === "red");
  const hasAmber = signals.some((signal) => signal.tone === "amber");
  if (hasRed) {
    return "The red signal above is the one to act on this week — it's the change most likely to cost you a regular if you wait. Start there.";
  }
  if (hasAmber) {
    return "Nothing's on fire this week. Skim the amber signal when you have a quiet minute — it's the one worth preparing for.";
  }
  return "A quiet week is a good week. If one signal deserves a nudge, the recommendation above is where to start.";
}

function digestFooter(businessLabel: string): string {
  return `You're receiving this because Localscope watches ${businessLabel}. Every signal links to a public source — check our work any time.`;
}

export function renderBriefEmail(input: BriefEmailInput): { subject: string; html: string; text: string } {
  const intro = input.intro ?? digestIntro(input.signals);
  const outro = input.outro ?? digestOutro(input.signals);

  const signalRows = input.signals
    .map((signal) => {
      const color = TONE_COLOR[signal.tone];
      return `
        <tr>
          <td style="padding:12px 0;border-top:1px solid ${RULE};vertical-align:top;width:18px;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-top:6px;"></span>
          </td>
          <td style="padding:12px 0;border-top:1px solid ${RULE};">
            <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${color};font-weight:600;">${escapeHtml(signal.label)}</div>
            <div style="font-family:Georgia,serif;font-size:17px;line-height:1.35;margin-top:4px;">${escapeHtml(signal.headline)}</div>
            <div style="font-size:13px;color:${MUTED};line-height:1.5;margin-top:4px;">${escapeHtml(signal.detail)}</div>
          </td>
        </tr>`;
    })
    .join("");

  const sourceLinks = (input.sources ?? [])
    .map((source) => `<a href="${escapeAttr(source.url)}" style="color:${MUTED};margin-right:12px;">${escapeHtml(source.label)}</a>`)
    .join("");

  const html = `
    <div style="background:${BACKDROP};padding:32px 16px;">
      <div style="max-width:560px;margin:0 auto;background:${PAPER};border:1px solid ${INK};border-radius:4px;padding:32px;">
        <div style="border-bottom:2px solid ${INK};padding-bottom:16px;">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};">Localscope · Weekly market brief</div>
          <div style="font-family:Georgia,serif;font-size:26px;line-height:1.2;margin-top:6px;">${escapeHtml(input.title)}</div>
        </div>
        <p style="font-size:14px;line-height:1.6;color:${INK};margin:18px 0 0;">${escapeHtml(intro)}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:10px;">${signalRows}</table>
        <div style="border-top:2px solid ${INK};margin-top:18px;padding-top:16px;">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${TONE_COLOR.amber};font-weight:600;">What we'd do</div>
          <div style="font-family:Georgia,serif;font-size:19px;line-height:1.4;margin-top:6px;color:${INK};">${escapeHtml(input.recommendation)}</div>
          <div style="font-size:13px;color:${MUTED};margin-top:8px;line-height:1.5;">Why: ${escapeHtml(input.why)}</div>
        </div>
        <div style="margin-top:22px;border-top:1px solid ${RULE};padding-top:14px;">
          <div style="font-size:14px;line-height:1.6;color:${INK};">${escapeHtml(outro)}</div>
          <div style="font-family:Georgia,serif;font-size:16px;color:${INK};margin-top:12px;">— the Localscope team</div>
          <div style="font-size:12px;color:${TONE_COLOR.amber};margin-top:2px;">We watch your local market. You just read the brief.</div>
        </div>
        ${sourceLinks ? `<div style="margin-top:22px;border-top:1px solid ${RULE};padding-top:12px;font-size:12px;">Sources checked:<br>${sourceLinks}</div>` : ""}
        <div style="margin-top:24px;">
          <a href="${escapeAttr(input.dashboardUrl)}" style="display:inline-block;background:${INK};color:${PAPER};text-decoration:none;padding:10px 18px;border-radius:3px;font-size:13px;">Open your dashboard</a>
        </div>
      </div>
      <p style="max-width:560px;margin:14px auto 0;font-size:11px;color:${FAINT};text-align:center;line-height:1.5;">
        ${escapeHtml(digestFooter(input.title.split(",")[0] ?? "your business"))}<br />
        Localscope — AI market research for local businesses. Sources are public and may be incomplete.
      </p>
    </div>`;

  const text = [
    `Localscope · Weekly market brief — ${input.title}`,
    "",
    intro,
    "",
    ...input.signals.map((signal) => `[${signal.label.toUpperCase()}] ${signal.headline}\n${signal.detail}`),
    "",
    "What we'd do:",
    input.recommendation,
    `Why: ${input.why}`,
    "",
    outro,
    "— the Localscope team",
    "We watch your local market. You just read the brief.",
    "",
    `Open your dashboard: ${input.dashboardUrl}`,
    digestFooter(input.title.split(",")[0] ?? "your business"),
  ].join("\n");

  return { subject: `Your Localscope brief — ${input.title}`, html, text };
}

// =====================================================================
// Variant 2 — The market alert ($50 tier: between weekly digests)
// =====================================================================

export type MarketAlertKind = "own_review" | "own_rating" | "price_cut" | "new_entrant" | "hours_change" | "general";

type MarketAlertInput = {
  kind: MarketAlertKind;
  tone: SignalTone;
  // The change itself, phrased as one short sentence (e.g. "Glow Studio cut
  // its women's cut from $60 to $51").
  headline: string;
  // The evidence line beneath the headline (distance, source, timing).
  detail?: string;
  // The single action we recommend.
  actionLabel: string;
  actionUrl: string;
  dashboardUrl: string;
  // Optional personalization ("your salon" default).
  businessName?: string;
};

type AlertCopy = {
  eyebrow: string;
  subject: string;
  body: string;
};

// The alert subject/eyebrow/body read differently depending on the kind —
// a one-star review on your own door is more urgent than a competitor's
// Tuesday discount. Copy is drafted per kind, then toned per severity.
function alertCopy(input: MarketAlertInput): AlertCopy {
  const subjectPrefix = input.businessName ? `${input.businessName}: ` : "";
  switch (input.kind) {
    case "own_review":
      return {
        eyebrow: "Your business · review alert",
        subject:
          input.tone === "red"
            ? `${subjectPrefix}A low review just landed on your listing`
            : `${subjectPrefix}New review on your listing`,
        body:
          input.tone === "red"
            ? "A low review is the most expensive thing that can happen to your listing this week — new customers read it before they book. Reply on Google within a day or two; owners who respond thoughtfully usually win the customer back and show everyone else you care."
            : "A good review is your cheapest marketing. Reply publicly — it nudges happy customers to leave one too, and it shows new browsers you pay attention.",
      };
    case "own_rating":
      return {
        eyebrow: "Your business · rating change",
        subject: `${subjectPrefix}Your rating moved`,
        body:
          input.tone === "red"
            ? "Your rating ticked down. Worth watching — a single review can swing it. If it keeps dropping, the reply cadence on low reviews is the lever."
            : "Your rating ticked up. Whatever you've been doing, keep doing it — and thank the customers behind it.",
      };
    case "price_cut":
      return {
        eyebrow: "Market · competitor price cut",
        subject: `${subjectPrefix}A competitor cut a price near you`,
        body:
          input.tone === "red"
            ? "A nearby competitor just cut a price. That's aimed at your customers, not theirs. Don't panic-match — but do check what they changed and decide whether your offer still holds up for the customers most likely to switch."
            : "A nearby competitor changed its pricing. Probably not urgent, but it's worth knowing before it shows up in a customer's comparison.",
      };
    case "new_entrant":
      return {
        eyebrow: "Market · new business nearby",
        subject: `${subjectPrefix}Something new is opening near you`,
        body:
          input.tone === "amber"
            ? "A new business just appeared in your area. New places pull in curious first-timers — some of whom are your regulars. Watch what it offers for a couple of weeks before deciding how to respond."
            : "A new business appeared nearby. Nothing to do yet — we'll flag it the moment it starts competing for your customers.",
      };
    case "hours_change":
      return {
        eyebrow: "Market · hours changed",
        subject: `${subjectPrefix}A nearby business changed its hours`,
        body:
          "Hours are how customers choose between you at 7pm on a Saturday. If this change eats into a slot that used to be yours alone, that's the signal.",
      };
    default:
      return {
        eyebrow: "Localscope · market alert",
        subject: `${subjectPrefix}A market update for you`,
        body: "Something changed in your market. Details below — and what we'd do about it.",
      };
  }
}

export function renderMarketAlert(input: MarketAlertInput): { subject: string; html: string; text: string } {
  const copy = alertCopy(input);
  const color = TONE_COLOR[input.tone];
  const business = input.businessName ?? "your business";

  const html = `
    <div style="background:${BACKDROP};padding:32px 16px;">
      <div style="max-width:520px;margin:0 auto;background:${PAPER};border:1px solid ${INK};border-radius:4px;padding:32px;">
        <div style="border-bottom:2px solid ${INK};padding-bottom:14px;">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${color};font-weight:600;">${escapeHtml(copy.eyebrow)}</div>
          <div style="font-family:Georgia,serif;font-size:23px;line-height:1.25;margin-top:8px;color:${INK};">${escapeHtml(input.headline)}</div>
        </div>
        ${input.detail ? `<p style="font-size:13px;color:${MUTED};line-height:1.5;margin:14px 0 0;">${escapeHtml(input.detail)}</p>` : ""}
        <p style="font-size:14px;line-height:1.6;color:${INK};margin:14px 0 0;">${escapeHtml(copy.body)}</p>
        <div style="margin-top:22px;">
          <a href="${escapeAttr(input.actionUrl)}" style="display:inline-block;background:${INK};color:${PAPER};text-decoration:none;padding:10px 18px;border-radius:3px;font-size:13px;">${escapeHtml(input.actionLabel)}</a>
          <a href="${escapeAttr(input.dashboardUrl)}" style="display:inline-block;color:${MUTED};text-decoration:underline;padding:10px 4px 10px 14px;font-size:13px;">Open your dashboard</a>
        </div>
      </div>
      <p style="max-width:520px;margin:14px auto 0;font-size:11px;color:${FAINT};text-align:center;line-height:1.5;">
        Sent because Localscope watches ${escapeHtml(business)} for you between your weekly briefs.
      </p>
    </div>`;

  const text = [
    `${copy.eyebrow.toUpperCase()} — ${input.headline}`,
    "",
    ...(input.detail ? [input.detail, ""] : []),
    copy.body,
    "",
    `${input.actionLabel}: ${input.actionUrl}`,
    `Open your dashboard: ${input.dashboardUrl}`,
    `Sent because Localscope watches ${business} between your weekly briefs.`,
  ].join("\n");

  return { subject: copy.subject, html, text };
}

// =====================================================================
// Delivery
// =====================================================================

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

export async function sendEmail(payload: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set" };
  const from = process.env["RESEND_FROM"];
  if (!from) {
    return {
      ok: false,
      error:
        "RESEND_FROM is not set — add a verified sender in Lovable Secrets, e.g. \"Localscope <briefs@yourdomain.com>\".",
    };
  }
  if (!/^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/.test(payload.to)) {
    return { ok: false, error: "Refusing to send to an invalid email address" };
  }
  if (!from.includes("@") || !from.includes("<")) {
    return {
      ok: false,
      error: `RESEND_FROM looks malformed ("${from}") — use the format "Localscope <briefs@yourdomain.com>".`,
    };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [payload.to], subject: payload.subject, html: payload.html, text: payload.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Resend returned ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Email send failed" };
  }
}
