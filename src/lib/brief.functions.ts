import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildEvidenceBrief, collectLocalResearch, researchForPrompt, type ResearchSource } from "@/lib/local-research.server";

const BriefInput = z.object({
  businessName: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(160),
  businessType: z.enum(["salon", "spa", "other"]).default("salon"),
});

export const SignalSchema = z.object({
  tone: z.enum(["red", "amber", "green"]),
  label: z.string(),
  headline: z.string(),
  detail: z.string(),
});

export const BriefSchema = z.object({
  title: z.string(),
  signals: z.array(SignalSchema),
  recommendation: z.string(),
  why: z.string(),
});

type GeneratedBrief = z.infer<typeof BriefSchema>;

export type Brief = GeneratedBrief & {
  sources: ResearchSource[];
  warnings: string[];
  capturedAt: string;
};

// Lenient shape for model output — tolerates alternate key names for the signal tone.
const LooseBrief = z.object({
  title: z.string(),
  signals: z.array(
    z
      .object({
        label: z.string(),
        headline: z.string(),
        detail: z.string(),
      })
      .passthrough(),
  ),
  recommendation: z.string(),
  why: z.string(),
});

export const generateSampleBrief = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => BriefInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; brief: Brief } | { ok: false; error: string }> => {
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

    const normalize = (raw: unknown): GeneratedBrief | null => {
      const parsed = LooseBrief.safeParse(raw);
      if (!parsed.success) return null;
      const signals = parsed.data.signals
        .map((s) => {
          const tone = Object.values(s).find(
            (v): v is Brief["signals"][number]["tone"] =>
              typeof v === "string" && ["red", "amber", "green"].includes(v.toLowerCase()),
          );
          return { tone: tone?.toLowerCase() as Brief["signals"][number]["tone"], label: s.label, headline: s.headline, detail: s.detail };
        })
        .filter((s) => !!s.tone)
        .slice(0, 3);
      if (signals.length === 0) return null;
      return { title: parsed.data.title, signals, recommendation: parsed.data.recommendation, why: parsed.data.why };
    };

    try {
      const result = streamText({
        model,
        prompt,
        output: Output.object({ schema: BriefSchema }),
      });
      const output = await result.output;
      const brief = normalize(output);
      if (!brief) console.error("brief: normalize failed", JSON.stringify(output));
      if (!brief) return { ok: false, error: "We couldn't assemble a brief just now. Please try again." };
      return { ok: true, brief: { ...brief, sources: research.sources, warnings: research.warnings, capturedAt: research.capturedAt } };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        try {
          const brief = normalize(JSON.parse(error.text ?? ""));
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
