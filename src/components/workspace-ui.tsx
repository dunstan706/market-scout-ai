// Small presentational kit shared by the /app workspace pages — status chips,
// unknown markers, and tone colors so every page renders provenance the same
// way. "Unknown" is a first-class state here: the product never guesses.

export function SourceChip({ label, url }: { label: string | null | undefined; url: string | null | undefined }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1 rounded-sm border border-rule px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-accent hover:text-accent"
    >
      <span aria-hidden>↗</span>
      {label ? <span className="max-w-[180px] truncate">{label}</span> : "source"}
    </a>
  );
}

export function FactStatusChip({ status }: { status: "reported" | "unknown" | "unavailable" }) {
  if (status === "reported") return null;
  return (
    <span
      className={`rounded-sm border px-1.5 py-0.5 text-[11px] font-medium ${
        status === "unknown"
          ? "border-rule text-muted-foreground"
          : "border-rule bg-paper-deep/40 text-muted-foreground"
      }`}
    >
      {status === "unknown" ? "unknown" : "n/a — not published"}
    </span>
  );
}

export function NeedsReviewChip() {
  return (
    <span className="rounded-sm border border-signal-amber/60 px-1.5 py-0.5 text-[11px] font-medium text-signal-amber">
      needs review
    </span>
  );
}

export function HealthChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "border-signal-green/50 text-signal-green",
    unreachable: "border-signal-red/60 text-signal-red",
    needs_review: "border-signal-amber/60 text-signal-amber",
  };
  const label: Record<string, string> = {
    active: "healthy",
    unreachable: "unreachable",
    needs_review: "check manually",
  };
  return (
    <span className={`rounded-sm border px-1.5 py-0.5 text-[11px] font-medium ${map[status] ?? "border-rule text-muted-foreground"}`}>
      {label[status] ?? status}
    </span>
  );
}

export const TONE_COLOR: Record<string, string> = {
  green: "text-signal-green",
  amber: "text-signal-amber",
  red: "text-signal-red",
  neutral: "text-foreground",
};

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-sm border border-dashed border-rule px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function SectionRow({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-rule py-4 last:border-b-0">{children}</div>;
}

export const btnPrimary =
  "rounded-sm border border-accent bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60";
export const btnGhost =
  "rounded-sm border border-rule px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-60";
export const btnDanger =
  "rounded-sm border border-signal-red/40 px-3 py-2 text-sm font-medium text-signal-red transition-colors hover:bg-signal-red/10 disabled:opacity-60";
export const inputCls =
  "w-full rounded-sm border border-rule/80 bg-card/50 px-3 py-2.5 text-sm text-foreground backdrop-blur-sm transition-colors placeholder:text-muted-foreground/60 focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20";
