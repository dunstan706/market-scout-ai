import { formatMoney, formatOrdinal, type MarketAnalysis } from "@/lib/market-analysis";
import { cn } from "@/lib/utils";

// Renders the market-intelligence content shared by both dashboards: local
// benchmarks, your position in the field, and multi-scan trends. Parents wrap
// this in their own card styling (paper-card on the classic dashboard, a
// translucent bordered panel on the globe dashboard). Returns null when there
// is no analysis yet (no scan has ever run).
type Row = {
  label: string;
  value: string;
  note?: string | undefined;
  tone?: "green" | "amber" | "red" | undefined;
};

const TONE_CLASS: Record<NonNullable<Row["tone"]>, string> = {
  green: "text-signal-green",
  amber: "text-signal-amber",
  red: "text-signal-red",
};

export function MarketSnapshot({ analysis, className }: { analysis: MarketAnalysis | null; className?: string }) {
  if (!analysis) return null;
  const b = analysis.benchmarks;
  const o = analysis.own;
  const t = analysis.trends;

  const rows: Row[] = [];
  if (b.competitorCount > 0) {
    const near =
      b.nearestMeters !== null
        ? b.nearestMeters < 1000
          ? `${b.nearestMeters} m`
          : `${(b.nearestMeters / 1000).toFixed(1)} km`
        : null;
    rows.push({
      label: "Competitors tracked",
      value: String(b.competitorCount),
      ...(near ? { note: `nearest ${near} away` } : {}),
    });
  }
  if (b.priceCurrency && b.pricedCount > 0 && b.entryPriceMedian !== null && b.entryPriceMin !== null && b.entryPriceMax !== null) {
    rows.push({
      label: "Local starting prices",
      value: `${formatMoney(b.entryPriceMedian, b.priceCurrency)} median`,
      note:
        b.pricedCount >= 3
          ? `range ${formatMoney(b.entryPriceMin, b.priceCurrency)}–${formatMoney(b.entryPriceMax, b.priceCurrency)} across ${b.pricedCount} that publish`
          : `across ${b.pricedCount} that publish${b.entryPriceMax !== b.entryPriceMin ? ` (${formatMoney(b.entryPriceMin, b.priceCurrency)}–${formatMoney(b.entryPriceMax, b.priceCurrency)})` : ""}`,
    });
  } else if (b.competitorCount > 0) {
    rows.push({
      label: "Starting prices",
      value: "No public prices found",
      note: "Competitor websites did not expose prices this scan.",
    });
  }
  if (b.reviewedCount > 0 && b.ratingMedian !== null) {
    rows.push({
      label: "Market rating",
      value: `${b.ratingMedian.toFixed(1)}/5 median`,
      note: `across ${b.reviewedCount} reviewed`,
    });
  }
  if (o.found) {
    if (o.rating !== undefined) {
      const rank =
        o.ratingRank !== null && o.reviewedCount > 0
          ? ` · ${formatOrdinal(o.ratingRank)} of ${o.reviewedCount} reviewed nearby`
          : "";
      rows.push({
        label: "Your rating",
        value: `${o.rating.toFixed(1)}/5`,
        note: rank.trim() ? rank : "fewer than 3 reviewed nearby to rank against",
        tone: o.rating >= 4.5 ? "green" : o.rating >= 3.5 ? "amber" : "red",
      });
    } else {
      rows.push({
        label: "Your listing",
        value: "Live on Google",
        note: "No rating yet — it appears after reviews come in.",
      });
    }
  } else if (b.reviewedCount > 0 || b.pricedCount > 0) {
    rows.push({
      label: "Your listing",
      value: "Not found on Google",
      note: "Add your business to Google Maps to start reputation tracking.",
      tone: "amber",
    });
  }
  if (o.found && o.ownPrice && o.ownPriceRank !== null && o.pricedCount > 0) {
    rows.push({
      label: "Your price",
      value: formatMoney(o.ownPrice.amount, o.ownPrice.currency),
      note:
        o.priceMedian !== null && o.priceMedian !== o.ownPrice.amount
          ? `${formatOrdinal(o.ownPriceRank)} cheapest of ${o.pricedCount} publishing · median ${formatMoney(o.priceMedian, o.ownPrice.currency)}`
          : `${formatOrdinal(o.ownPriceRank)} cheapest of ${o.pricedCount} publishing`,
      tone:
        o.ownPriceRank !== null && o.ownPriceRank <= 2 && o.priceMedian !== null && o.ownPrice.amount < o.priceMedian
          ? "green"
          : undefined,
    });
  } else if (o.found && !o.ownPrice && b.pricedCount > 0) {
    rows.push({
      label: "Your price",
      value: "Not set yet",
      note:
        o.priceMedian !== null && b.priceCurrency
          ? `Add your typical price in Details to rank against the local median (${formatMoney(o.priceMedian, b.priceCurrency)}).`
          : "Add your typical price in Details to rank against the local market.",
      tone: "amber",
    });
  }

  if (rows.length === 0) return null;

  return (
    <dl className={cn("space-y-2.5", className)}>
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground/80">{row.label}</dt>
          <dd className="min-w-0 text-right">
            <span className={cn("font-serif text-base leading-snug", row.tone ? TONE_CLASS[row.tone] : "text-foreground")}>
              {row.value}
            </span>
            {row.note && <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground/90">{row.note}</span>}
          </dd>
        </div>
      ))}
      {t.sufficient && (
        <p className="rule-top pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {trendNote(t)}
        </p>
      )}
    </dl>
  );
}

function trendNote(t: NonNullable<MarketAnalysis>["trends"]): string {
  const span =
    t.spanDays !== null && t.spanDays >= 30
      ? `${Math.round(t.spanDays / 30)} month${Math.round(t.spanDays / 30) === 1 ? "" : "s"}`
      : t.spanDays !== null
        ? `${Math.round(t.spanDays)} day${Math.round(t.spanDays) === 1 ? "" : "s"}`
        : "recent scans";
  const parts: string[] = [];
  if (t.priceTracked > 0) {
    const moves: string[] = [];
    if (t.priceFell > 0) moves.push(`${t.priceFell} cut entry prices`);
    if (t.priceRose > 0) moves.push(`${t.priceRose} raised them`);
    if (t.priceFell === 0 && t.priceRose === 0) moves.push("entry prices steady");
    parts.push(`Over ${span} (${t.snapshotCount} scans): ${moves.join(", ")}`);
  }
  if (t.avgReviewVelocityPerWeek !== null && t.comparable > 0) {
    parts.push(
      `${t.avgReviewVelocityPerWeek >= 0 ? "+" : ""}${t.avgReviewVelocityPerWeek.toFixed(1)} reviews per business / week`,
    );
  }
  if (t.ratingMoversTop.length > 0) {
    parts.push(
      `rating moves: ${t.ratingMoversTop.map((mover) => `${mover.name} ${mover.from.toFixed(1)}→${mover.to.toFixed(1)}`).join(", ")}`,
    );
  }
  if (t.newEntrants.length > 0) {
    parts.push(`new in the area: ${t.newEntrants.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : `Trends build as more scans run (${t.snapshotCount} stored).`;
}
