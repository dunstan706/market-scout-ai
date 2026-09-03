import { BriefSchema, normalizeLooseBrief, type GeneratedBrief } from "@/lib/brief-core";
import { buildEvidenceBrief, researchForPrompt, type ResearchSnapshot } from "@/lib/local-research.server";
import { changesToBriefSignals, type DetectedChange } from "@/lib/change-detection";

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

async function writeAiBrief({ input, research, changes }: BriefWriterOptions): Promise<GeneratedBrief> {
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

  const prompt = `You are Localscope, an AI local-market analyst for small businesses.
Write a Weekly Market Brief for this business:
- Name: ${input.businessName}
- Type: ${input.businessType}
- Location: ${input.location}

${changeBlock}Use only the supplied research evidence and detected changes. Do not use prior knowledge, web knowledge, plausible examples, or invented numbers. Never claim a price change, new opening, review trend, or competitor action unless the evidence or a detected change explicitly contains it — including old and new values where a change is reported. If a category has no evidence, say that it is unavailable instead of guessing.
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

function buildFallbackBrief({ input, research, changes }: BriefWriterOptions): GeneratedBrief {
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