import { createServerFn } from "@tanstack/react-start";
import { buildEvidenceBrief, collectLocalResearch, researchForPrompt, type ResearchSource } from "@/lib/local-research.server";
import { BriefInput, BriefSchema, normalizeLooseBrief, type GeneratedBrief } from "@/lib/brief-core";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit.server";

export type Brief = GeneratedBrief & {
  sources: ResearchSource[];
  warnings: string[];
  capturedAt: string;
};

// A bot that fills the honeypot field gets a fake success with zero research,
// zero LLM calls — and no indication that it was detected.
function honeypotBrief(input: { businessName: string; location: string }): Brief {
  return {
    title: `${input.businessName}, ${input.location}`,
    signals: [
      {
        tone: "green",
        label: "On its way",
        headline: "Your sample brief is being prepared",
        detail: "We'll email your first brief once your neighbourhood opens.",
      },
    ],
    recommendation: "Join the waitlist to get your first brief free.",
    why: "We'll watch your local market and send the brief when your city opens.",
    sources: [],
    warnings: [],
    capturedAt: new Date().toISOString(),
  };
}

function formatRetry(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export const generateSampleBrief = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => BriefInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; brief: Brief } | { ok: false; error: string }> => {
    // Honeypot: real users never see the hidden "website" field.
    if (data.website) {
      return { ok: true, brief: honeypotBrief(data) };
    }

    // Per-IP rate limit — the generator spends real money per call (Google
    // Places, website fetches, an LLM call) and is fully public. Dynamic import
    // keeps the server-only module out of the client bundle (see client.server.ts).
    const { getRequest } = await import("@tanstack/react-start/server");
    const ip = clientIpFromRequest(getRequest()) ?? "unknown";
    const limit = checkRateLimit(`brief:${ip}`);
    if (!limit.allowed) {
      return {
        ok: false,
        error: `We're generating a lot of briefs right now — try again in ${formatRetry(limit.retryAfterSeconds)}.`,
      };
    }

    let research;
    try {
      research = await collectLocalResearch(data);
    } catch (error) {
      console.error("local research failed", error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "We couldn't reach the public research sources. Please try again.",
      };
    }

    const evidenceBrief = buildEvidenceBrief(data, research);
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return {
        ok: true,
        brief: { ...evidenceBrief, sources: research.sources, warnings: research.warnings, capturedAt: research.capturedAt },
      };
    }

    const [{ streamText, Output, NoObjectGeneratedError }, { createLovableAiGatewayProvider }] = await Promise.all([
      import("ai"),
      import("@/lib/ai-gateway.server"),
    ]);

    const gateway = createLovableAiGatewayProvider(apiKey);
    const model = gateway("google/gemini-3.7-flash");

    const prompt = `You are Localscope, an AI local-market analyst for small businesses.
Write an illustrative Weekly Market Brief for this business:
- Name: ${data.businessName}
- Type: ${data.businessType}
- Location: ${data.location}

Use only the supplied research evidence. Do not use prior knowledge, web knowledge, plausible examples, or invented numbers. Never claim a price change, new opening, review trend, or competitor action unless the evidence explicitly contains it. If a category has no evidence, say that it is unavailable instead of guessing.
Return exactly 3 evidence-backed signals: one red (important market fact), one amber (pricing or availability fact), and one green (review or strength fact). Each signal has a short label (2-3 words), a headline under 80 characters, and a detail under 160 characters. Include the source name in the detail when possible.
Then one recommendation (under 220 characters) and a one-sentence "why". Title should be "<business name>, <neighbourhood or city>". Plain text only, no markdown.

Live research snapshot:
${researchForPrompt(research)}

Respond with JSON using EXACTLY these keys:
{"title": string, "signals": [{"tone": "red"|"amber"|"green", "label": string, "headline": string, "detail": string}], "recommendation": string, "why": string}`;

    try {
      const result = streamText({
        model,
        prompt,
        output: Output.object({ schema: BriefSchema }),
      });
      const output = await result.output;
      const brief = normalizeLooseBrief(output);
      if (!brief) console.error("brief: normalize failed", JSON.stringify(output));
      if (!brief) return { ok: false, error: "We couldn't assemble a brief just now. Please try again." };
      return { ok: true, brief: { ...brief, sources: research.sources, warnings: research.warnings, capturedAt: research.capturedAt } };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        try {
          const brief = normalizeLooseBrief(JSON.parse(error.text ?? ""));
          if (brief) return { ok: true, brief: { ...brief, sources: research.sources, warnings: research.warnings, capturedAt: research.capturedAt } };
        } catch {
          /* fall through */
        }
        console.error("brief: no object generated", error.text);
        return { ok: false, error: "We couldn't assemble a brief just now. Please try again." };
      }
      const status = (error as { statusCode?: number })?.statusCode;
      console.error("brief generation failed", error);
      if (status === 429) return { ok: false, error: "We're generating a lot of briefs right now — try again in a minute." };
      if (status === 402) return { ok: false, error: "The brief generator is temporarily paused. Please join the waitlist and we'll send yours by email." };
      return { ok: false, error: "Something went wrong generating your brief. Please try again." };
    }
  });