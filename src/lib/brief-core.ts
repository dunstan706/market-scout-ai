import { z } from "zod";

// Shared validation and normalization for brief generation. Client-safe module:
// no server-only imports, so it can be unit-tested in isolation.

export const BriefInput = z.object({
  businessName: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(160),
  businessType: z.enum(["salon", "spa", "other"]).default("salon"),
  // Honeypot field — a hidden input real users never fill. Bots that fill it
  // are short-circuited server-side before any research runs.
  website: z.string().max(200).optional(),
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

export type GeneratedBrief = z.infer<typeof BriefSchema>;

export type SignalTone = "red" | "amber" | "green";

// Lenient shape for model output — tolerates alternate key names for the
// signal tone (e.g. "severity" instead of "tone").
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

export function normalizeLooseBrief(raw: unknown): GeneratedBrief | null {
  const parsed = LooseBrief.safeParse(raw);
  if (!parsed.success) return null;
  const signals = parsed.data.signals
    .map((s) => {
      const tone = Object.values(s).find(
        (v): v is SignalTone =>
          typeof v === "string" && ["red", "amber", "green"].includes(v.toLowerCase()),
      );
      return { tone: tone?.toLowerCase() as SignalTone, label: s.label, headline: s.headline, detail: s.detail };
    })
    .filter((s) => !!s.tone)
    .slice(0, 3);
  if (signals.length === 0) return null;
  return { title: parsed.data.title, signals, recommendation: parsed.data.recommendation, why: parsed.data.why };
}