import { BriefSchema, normalizeLooseBrief, type GeneratedBrief } from "@/lib/brief-core";
import { buildEvidenceBrief, researchForPrompt, type ResearchSnapshot } from "@/lib/local-research.server";
import { changesToBriefSignals, type DetectedChange } from "@/lib/change-detection";
import {
  analysisForPrompt,
  formatMoney,
  formatOrdinal,
  type MarketAnalysis,
} from "@/lib/market-analysis";

// Shared brief writer used by the public sample generator, the authenticated
// dashboard, and the weekly monitoring run. When detected changes are supplied
// (a previous snapshot existed), both the AI path and the deterministic
// fallback ground the brief in real deltas instead of a one-shot look.

export type BriefSourceInput = {
  businessName: string;
  businessType: string;
  location: string;
};

export type BriefWriterOptions = {
  input: BriefSourceInput;
  research: ResearchSnapshot;
  changes?: DetectedChange[];
  analysis?: MarketAnalysis;
};

export type BriefErrorCode = "no_object" | "rate_limited" | "paused" | "unknown";

export class BriefGenerationError extends Error {
  code: BriefErrorCode;
  constructor(code: BriefErrorCode, message?: string) {
    super(message ?? code);
    this.name = "BriefGenerationError";
    this.code = code;
  }
}

export function describeBriefError(error: unknown): string {
  if (error instanceof BriefGenerationError) {
    switch (error.code) {
      case "rate_limited":
        return "We're generating a lot of briefs right now — try again in a minute.";
      case "paused":
        return "The brief generator is temporarily paused. Please join the waitlist and we'll send yours by email.";
      case "no_object":
        return "We couldn't assemble a brief just now. Please try again.";
      default:
        return "Something went wrong generating your brief. Please try again.";
    }
  }
  return error instanceof Error ? error.message : "Something went wrong generating your brief. Please try again.";
}

export async function writeBrief(options: BriefWriterOptions): Promise<GeneratedBrief> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return buildFallbackBrief(options);
  return writeAiBrief(options);
}

async function writeAiBrief({ input, research, changes, analysis }: BriefWriterOptions): Promise<GeneratedBrief> {
  const apiKey = process.env["LOVABLE_API_KEY"] as string;
  const [{ streamText, Output, NoObjectGeneratedError }, { createLovableAiGatewayProvider }] = await Promise.all([
    import("ai"),
    import("@/lib/ai-gateway.server"),
  ]);

  const gateway = createLovableAiGatewayProvider(apiKey);
  const model = gateway("google/gemini-3.7-flash");

  const changeBlock =
    changes && changes.length > 0
      ? `Changes detected since the previous brief (these are real, measured between consecutive scans — prefer them as your signals):\n${changes
          .map((c) => `- [${c.tone}] ${c.headline}: ${c.detail}`)
          .join("\n")}\n\n`
      : "";

  // Market context is computed from the same stored scans (see
  // market-analysis.ts) — it is derived evidence with explicit denominators
  // ("among N that publish prices"), so it can anchor "where you stand"
  // signals without inventing numbers.
  const marketBlock = analysis ? analysisForPrompt(analysis) : "";

  const prompt = `You are Localscope, an AI local-market analyst for small businesses.
Write a Weekly Market Brief for this business:
- Name: ${input.businessName}
- Type: ${input.businessType}
- Location: ${input.location}

${changeBlock}${marketBlock ? `${marketBlock}\n\n` : ""}Use only the supplied research evidence, detected changes, and market context. Do not use prior knowledge, web knowledge, plausible examples, or invented numbers. Never claim a price change, new opening, review trend, or competitor action unless the evidence, a detected change, or the market context explicitly contains it — including old and new values where a change is reported. You may report where the business sits in the market (rating rank, price position) only when the market context states it with a denominator. If a category has no evidence, say that it is unavailable instead of guessing.
Return exactly 3 signals: one red (important market fact or threat), one amber (watch item), and one green (opportunity or strength). Each signal has a short label (2-3 words), a headline under 80 characters, and a detail under 160 characters. Include the source name and old → new values in the detail when a change is reported.
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
    if (!brief) {
      console.error("brief: normalize failed", JSON.stringify(output));
      throw new BriefGenerationError("no_object");
    }
    return brief;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      try {
        const brief = normalizeLooseBrief(JSON.parse(error.text ?? ""));
        if (brief) return brief;
      } catch {
        /* fall through */
      }
      console.error("brief: no object generated", error.text);
      throw new BriefGenerationError("no_object");
    }
    const status = (error as { statusCode?: number })?.statusCode;
    console.error("brief generation failed", error);
    if (status === 429) throw new BriefGenerationError("rate_limited");
    if (status === 402) throw new BriefGenerationError("paused");
    throw new BriefGenerationError("unknown");
  }
}

function buildFallbackBrief({ input, research, changes, analysis }: BriefWriterOptions): GeneratedBrief {
  const evidence = buildEvidenceBrief(input, research);
  const signals: GeneratedBrief["signals"] = [];
  for (const change of changesToBriefSignals(changes ?? [])) {
    if (signals.length >= 3) break;
    signals.push(change);
  }
  for (const signal of evidence.signals) {
    if (signals.length >= 3) break;
    if (!signals.some((existing) => existing.headline === signal.headline)) {
      signals.push(signal);
    }
  }
  // Own-listing position is a high-value signal the evidence brief can't see
  // (it only looks at competitors) — add it once nothing already covers it.
  const own = analysis?.own;
  if (
    signals.length < 3 &&
    own?.found &&
    own.rating !== undefined &&
    !signals.some((signal) => signal.label === "Your business" || /^Your (listing|rating|price)/.test(signal.headline))
  ) {
    const rank =
      own.ratingRank !== null && own.reviewedCount > 0
        ? ` — ${formatOrdinal(own.ratingRank)} of ${own.reviewedCount} reviewed nearby`
        : "";
    signals.push({
      tone: own.rating >= 4.5 ? "green" : own.rating >= 3.5 ? "amber" : "red",
      label: "Your business",
      headline: `Your listing is rated ${own.rating.toFixed(1)}/5${rank}`,
      detail:
        (own.reviewCount !== undefined && own.reviewCount > 0
          ? `${own.reviewCount} ratings on your listing`
          : "Your listing is live on Google Places") + " · source: Google Places",
    });
  }
  // Price position makes the brief actionable; only when your price is set.
  if (
    signals.length < 3 &&
    own?.found &&
    own.ownPrice &&
    own.ownPriceRank !== null &&
    own.pricedCount > 0 &&
    !signals.some((signal) => signal.label === "Your business" || /^Your (listing|rating|price)/.test(signal.headline))
  ) {
    const median =
      own.priceMedian !== null
        ? ` (median ${formatMoney(own.priceMedian, own.ownPrice.currency)})`
        : "";
    signals.push({
      tone: "green",
      label: "Your price",
      headline: `Your price sits ${formatOrdinal(own.ownPriceRank)} cheapest of ${own.pricedCount} publishing`,
      detail: `At ${formatMoney(own.ownPrice.amount, own.ownPrice.currency)}${median} · source: Google Places`,
    });
  }
  // Evidence always supplies three signals; this guard keeps the type honest.
  if (signals.length === 0) signals.push(...evidence.signals);

  const hasChanges = (changes?.length ?? 0) > 0;
  return {
    title: evidence.title,
    signals,
    recommendation: hasChanges
      ? "The changes above were measured between consecutive scans of public sources — validate the ones that matter before acting."
      : evidence.recommendation,
    why: hasChanges
      ? "This brief reports changes observed across repeated scans rather than guessing from a single look."
      : evidence.why,
  };
}