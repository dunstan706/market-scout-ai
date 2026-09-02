import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { joinWaitlist } from "@/lib/waitlist.functions";

type Status = "idle" | "loading" | "done" | "error";

export function WaitlistForm({ compact = false }: { compact?: boolean }) {
  const submit = useServerFn(joinWaitlist);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setStatus("loading");
    setMessage("");
    try {
      const res = await submit({
        data: {
          email: String(fd.get("email") ?? ""),
          businessName: String(fd.get("businessName") ?? ""),
          city: String(fd.get("city") ?? ""),
          businessType: (fd.get("businessType") as "salon" | "spa" | "other") ?? "salon",
        },
      });
      setStatus("done");
      setMessage(
        res.duplicate
          ? "You're already on the list — we'll be in touch soon."
          : "You're in. We'll send your first sample brief shortly.",
      );
      form.reset();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="paper-card rounded-md p-6 text-center animate-rise">
        <p className="font-serif text-2xl">Thank you.</p>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  const input =
    "w-full rounded-sm border border-input bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring";

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className={compact ? "flex flex-col gap-3 sm:flex-row" : "grid gap-3 sm:grid-cols-2"}>
        <input
          className={input}
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@yoursalon.in"
          aria-label="Email address"
        />
        {!compact && (
          <>
            <input className={input} name="businessName" placeholder="Salon / spa name" aria-label="Business name" />
            <input className={input} name="city" placeholder="City (e.g. Bengaluru)" aria-label="City" />
            <select className={input} name="businessType" defaultValue="salon" aria-label="Business type">
              <option value="salon">Salon</option>
              <option value="spa">Spa</option>
              <option value="other">Other</option>
            </select>
          </>
        )}
        {compact && (
          <button
            type="submit"
            disabled={status === "loading"}
            className="shrink-0 rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            {status === "loading" ? "Saving…" : "Get early access"}
          </button>
        )}
      </div>
      {!compact && (
        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full rounded-sm bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent disabled:opacity-60 sm:w-auto"
        >
          {status === "loading" ? "Saving…" : "Join the waitlist"}
        </button>
      )}
      {status === "error" && <p className="text-sm text-signal-red">{message}</p>}
      <p className="text-xs text-muted-foreground">No spam. One email when your city opens.</p>
    </form>
  );
}
