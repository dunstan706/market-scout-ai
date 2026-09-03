import { createServerFn } from "@tanstack/react-start";
import { collectLocalResearch, type ResearchSource } from "@/lib/local-research.server";
import { BriefInput, type GeneratedBrief } from "@/lib/brief-core";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit.server";
import { describeBriefError, writeBrief } from "@/lib/brief-writer.server";

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
  .validator((input: unknown) => BriefInput.parse(input))
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

    // The public demo has no history, so it is a one-shot snapshot brief.
    // Authenticated users get change-aware briefs via generateMonitoringBrief.
    try {
      const generated = await writeBrief({ input: data, research });
      return {
        ok: true,
        brief: { ...generated, sources: research.sources, warnings: research.warnings, capturedAt: research.capturedAt },
      };
    } catch (error) {
      console.error("generateSampleBrief failed", error);
      return { ok: false, error: describeBriefError(error) };
    }
  });