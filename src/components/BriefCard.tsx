type Tone = "red" | "amber" | "green";

export type Signal = { tone: Tone; label: string; headline: string; detail: string };

const toneClasses: Record<Tone, { dot: string; chip: string }> = {
  red: { dot: "bg-signal-red", chip: "bg-signal-red-soft text-signal-red" },
  amber: { dot: "bg-signal-amber", chip: "bg-signal-amber-soft text-signal-amber" },
  green: { dot: "bg-signal-green", chip: "bg-signal-green-soft text-signal-green" },
};

export function BriefCard({
  title,
  dateLabel,
  signals,
  recommendation,
  why,
}: {
  title: string;
  dateLabel: string;
  signals: Signal[];
  recommendation: string;
  why: string;
}) {
  return (
    <article className="paper-card rounded-md p-7 md:p-10 shadow-lift">
      <div className="flex items-baseline justify-between gap-4 border-b border-ink pb-4">
        <div>
          <p className="eyebrow">Weekly Market Brief</p>
          <h3 className="mt-1 font-serif text-3xl">{title}</h3>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">{dateLabel}</p>
      </div>

      <ol className="divide-y divide-rule">
        {signals.map((s, i) => {
          const t = toneClasses[s.tone];
          return (
            <li key={`${i}-${s.headline}`} className="flex gap-5 py-6">
              <span className="font-serif text-3xl text-muted-foreground/60">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${t.chip}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
                  {s.label}
                </span>
                <p className="mt-2 font-serif text-xl leading-snug">{s.headline}</p>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{s.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="rule-top mt-2 pt-6">
        <p className="eyebrow text-accent">Recommendation</p>
        <p className="mt-2 font-serif text-2xl leading-snug">{recommendation}</p>
        <p className="mt-3 text-sm text-muted-foreground">Why: {why}</p>
      </div>
    </article>
  );
}
