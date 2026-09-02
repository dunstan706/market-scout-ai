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
Then one recommendation (under 220 characters) and a one-sentence "why". Title should be "<business name>, <neighbourhood or city>". Plain text only, no markdown.`;

    try {
      const result = streamText({
        model,
        prompt,
        output: Output.object({ schema: BriefSchema }),
      });
      const output = await result.output;
      const signals = output.signals.slice(0, 3);
      return { ok: true, brief: { ...output, signals } };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
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
