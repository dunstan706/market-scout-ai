// Weekly brief delivery through the Resend REST API (plain fetch — no SDK
// dependency). Requires RESEND_API_KEY and RESEND_FROM (a verified sender on
// the Resend account, e.g. "Localscope <briefs@localscope.app>").

type BriefEmailInput = {
  title: string;
  signals: Array<{
    tone: "red" | "amber" | "green";
    label: string;
    headline: string;
    detail: string;
  }>;
  recommendation: string;
  why: string;
  sources?: Array<{ label: string; url: string }>;
  dashboardUrl: string;
};

const TONE_COLOR: Record<BriefEmailInput["signals"][number]["tone"], string> = {
  red: "#DC2626",
  amber: "#B45309",
  green: "#15803D",
};

export function renderBriefEmail(input: BriefEmailInput): { subject: string; html: string; text: string } {
  const signalRows = input.signals
    .map((signal) => {
      const color = TONE_COLOR[signal.tone];
      return `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #E7DFD0;vertical-align:top;width:18px;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-top:6px;"></span>
          </td>
          <td style="padding:10px 0;border-top:1px solid #E7DFD0;">
            <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${color};font-weight:600;">${escapeHtml(signal.label)}</div>
            <div style="font-family:Georgia,serif;font-size:17px;line-height:1.35;margin-top:4px;">${escapeHtml(signal.headline)}</div>
            <div style="font-size:13px;color:#6B6459;line-height:1.5;margin-top:4px;">${escapeHtml(signal.detail)}</div>
          </td>
        </tr>`;
    })
    .join("");

  const sourceLinks = (input.sources ?? [])
    .map((source) => `<a href="${escapeAttr(source.url)}" style="color:#6B6459;margin-right:12px;">${escapeHtml(source.label)}</a>`)
    .join("");

  const html = `
    <div style="background:#F5F0E6;padding:32px 16px;">
      <div style="max-width:560px;margin:0 auto;background:#FDFBF5;border:1px solid #2B2620;border-radius:4px;padding:32px;">
        <div style="border-bottom:2px solid #2B2620;padding-bottom:16px;">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#6B6459;">Weekly Market Brief</div>
          <div style="font-family:Georgia,serif;font-size:26px;line-height:1.2;margin-top:6px;">${escapeHtml(input.title)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;">${signalRows}</table>
        <div style="border-top:2px solid #2B2620;margin-top:16px;padding-top:16px;">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#B45309;font-weight:600;">Recommendation</div>
          <div style="font-family:Georgia,serif;font-size:19px;line-height:1.35;margin-top:6px;">${escapeHtml(input.recommendation)}</div>
          <div style="font-size:13px;color:#6B6459;margin-top:8px;">Why: ${escapeHtml(input.why)}</div>
        </div>
        ${sourceLinks ? `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #E7DFD0;font-size:12px;">Sources checked:<br>${sourceLinks}</div>` : ""}
        <div style="margin-top:24px;">
          <a href="${escapeAttr(input.dashboardUrl)}" style="display:inline-block;background:#2B2620;color:#FDFBF5;text-decoration:none;padding:10px 18px;border-radius:3px;font-size:13px;">Open your dashboard</a>
        </div>
      </div>
      <p style="max-width:560px;margin:12px auto 0;font-size:11px;color:#8A8378;text-align:center;">
        Localscope — AI market research for local businesses. Automated brief; sources are public and may be incomplete.
      </p>
    </div>`;

  const text = [
    `Weekly Market Brief — ${input.title}`,
    "",
    ...input.signals.map((signal) => `[${signal.label.toUpperCase()}] ${signal.headline}\n${signal.detail}`),
    "",
    `Recommendation: ${input.recommendation}`,
    `Why: ${input.why}`,
    "",
    `Open your dashboard: ${input.dashboardUrl}`,
  ].join("\n");

  return { subject: `Your Localscope market brief — ${input.title}`, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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
  const from = process.env["RESEND_FROM"] ?? "Localscope <onboarding@resend.dev>";
  if (!/^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/.test(payload.to)) {
    return { ok: false, error: "Refusing to send to an invalid email address" };
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