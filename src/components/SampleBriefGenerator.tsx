import { useState, type FormEvent } from "react";
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
          Tell us your business and neighbourhood. In about twenty seconds our AI drafts an illustrative brief so you
          can see exactly what lands in your inbox each Monday.
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-3" noValidate>
          <input className={input} name="businessName" required minLength={2} placeholder="Business name" aria-label="Business name" />
          <input className={input} name="location" required minLength={2} placeholder="Neighbourhood, city (e.g. Shoreditch, London)" aria-label="Location" />
          <select className={input} name="businessType" defaultValue="salon" aria-label="Business type">
            <option value="salon">Salon</option>
            <option value="spa">Spa</option>
            <option value="other">Other</option>
          </select>
          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full rounded-sm bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent disabled:opacity-60 sm:w-auto"
          >
            {status === "loading" ? "Researching your area…" : "Generate my sample brief"}
          </button>
          {status === "error" && <p className="text-sm text-signal-red">{error}</p>}
          <p className="text-xs text-muted-foreground">
            Sample briefs are AI-drafted illustrations, not verified monitoring. Real briefs use live data.
          </p>
        </form>
      </div>

      <div aria-live="polite">
        {brief ? (
          <div className="animate-rise">
            <BriefCard title={brief.title} signals={brief.signals} recommendation={brief.recommendation} why={brief.why} dateLabel="Sample · this week" />
          </div>
        ) : (
          <div className="paper-card flex min-h-[360px] items-center justify-center rounded-md border-dashed p-10 text-center">
            <p className="max-w-xs font-serif text-2xl text-muted-foreground/70">
              {status === "loading" ? "Scanning listings, reviews and local activity…" : "Your brief will appear here."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
