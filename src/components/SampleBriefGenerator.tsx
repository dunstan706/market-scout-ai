import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { generateSampleBrief, type Brief } from "@/lib/brief.functions";
import { BriefCard } from "@/components/BriefCard";

type Status = "idle" | "loading" | "done" | "error";

const input =
  "w-full rounded-sm border border-input bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring";

export function SampleBriefGenerator() {
  const generate = useServerFn(generateSampleBrief);
  const [status, setStatus] = useState<Status>("idle");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setStatus("loading");
    setError("");
    try {
      const res = await generate({
        data: {
          businessName: String(fd.get("businessName") ?? ""),
          location: String(fd.get("location") ?? ""),
          businessType: (fd.get("businessType") as "salon" | "spa" | "other") ?? "salon",
          // Honeypot — invisible to humans; bots that fill it are ignored server-side.
          website: String(fd.get("website") ?? ""),
        },
      });
      if (res.ok) {
        setBrief(res.brief);
        setStatus("done");
      } else {
        setError(res.error);
        setStatus("error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-start">
      <div>
        <p className="eyebrow">Try it</p>
        <h2 className="mt-4 text-4xl leading-tight md:text-5xl">Generate your sample brief.</h2>
        <p className="mt-5 text-muted-foreground leading-relaxed">
          Tell us your business and neighbourhood. We’ll check public directories, business websites, and connected review
          data, then turn what we find into a sourced brief.
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-3" noValidate>
          <input className={input} name="businessName" required minLength={2} placeholder="Business name" aria-label="Business name" />
          <input className={input} name="location" required minLength={2} placeholder="Neighbourhood, city (e.g. Shoreditch, London)" aria-label="Location" />
          <select className={input} name="businessType" defaultValue="salon" aria-label="Business type">
            <option value="salon">Salon</option>
            <option value="spa">Spa</option>
            <option value="other">Other</option>
          </select>
          {/* Honeypot — visually hidden, never meant to be filled. See brief.functions.ts. */}
          <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
            <label htmlFor="website-field">Leave this field empty</label>
            <input id="website-field" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full rounded-sm bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent disabled:opacity-60 sm:w-auto"
          >
            {status === "loading" ? "Checking live sources…" : "Generate my live brief"}
          </button>
          {status === "error" && <p className="text-sm text-signal-red">{error}</p>}
          <p className="text-xs text-muted-foreground">
             Every generated claim is grounded in the sources we could reach. Missing sources are called out instead of guessed.
          </p>
          <p className="text-xs text-muted-foreground">
            Like this brief?{" "}
            <Link to="/signup" className="underline decoration-rule underline-offset-2 hover:text-foreground">
              Create a free account
            </Link>{" "}
            to save your business and get weekly scans of what changes nearby.
          </p>
        </form>
      </div>

      <div aria-live="polite">
        {brief ? (
          <div className="animate-rise">
            <BriefCard
              title={brief.title}
              signals={brief.signals}
              recommendation={brief.recommendation}
              why={brief.why}
              dateLabel={`Live research · ${new Date(brief.capturedAt).toLocaleDateString()}`}
              sources={brief.sources}
              warnings={brief.warnings}
            />
          </div>
        ) : (
          <div className="paper-card flex min-h-[360px] items-center justify-center rounded-md border-dashed p-10 text-center">
            <p className="max-w-xs font-serif text-2xl text-muted-foreground/70">
              {status === "loading" ? "Checking listings, websites and review evidence…" : "Your brief will appear here."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
