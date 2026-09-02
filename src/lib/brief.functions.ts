import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

export type Brief = z.infer<typeof BriefSchema>;

// Lenient shape for model output — tolerates alternate key names for the signal tone.
const LooseBrief = z.object({
  title: z.string(),
  signals: z.array(
    z.object({
      tone: z.string().optional(),
      status: z.string().optional(),
      severity: z.string().optional(),
      label: z.string(),
      headline: z.string(),
      detail: z.string(),
    }),
  ),
  recommendation: z.string(),
  why: z.string(),
});

export const generateSampleBrief = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => BriefInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; brief: Brief } | { ok: false; error: string }> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false, error: "The brief generator isn't configured yet." };

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

Use your knowledge of the area (typical neighbourhoods, local competitors, price levels, currency, seasonality) to make it feel specific and realistic, but never claim certainty about a real competitor's actions — phrase competitor names as plausible local examples.
Return exactly 3 signals: one red (act this week), one amber (keep an eye on), one green (a strength to lean into). Each signal has a short label (2-3 words), a headline under 80 characters, and a detail under 160 characters with a concrete number, price, or distance in the local currency and units.
Then one recommendation (under 220 characters) and a one-sentence "why". Title should be "<business name>, <neighbourhood or city>". Plain text only, no markdown.

Respond with JSON using EXACTLY these keys:
{"title": string, "signals": [{"tone": "red"|"amber"|"green", "label": string, "headline": string, "detail": string}], "recommendation": string, "why": string}`;

    const normalize = (raw: unknown): Brief | null => {
      const parsed = LooseBrief.safeParse(raw);
      if (!parsed.success) return null;
      const signals = parsed.data.signals
        .map((s) => ({
          tone: (s.tone ?? s.status ?? s.severity ?? "amber") as Brief["signals"][number]["tone"],
          label: s.label,
          headline: s.headline,
          detail: s.detail,
        }))
        .filter((s) => ["red", "amber", "green"].includes(s.tone))
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
      if (!brief) return { ok: false, error: "We couldn't assemble a brief just now. Please try again." };
      return { ok: true, brief };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        try {
          const brief = normalize(JSON.parse(error.text ?? ""));
          if (brief) return { ok: true, brief };
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
