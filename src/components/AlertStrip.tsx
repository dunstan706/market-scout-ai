import { useServerFn } from "@tanstack/react-start";
import { acknowledgeMarketAlert, type MarketAlertRow } from "@/lib/alert.functions";

const TONE_DOT: Record<string, string> = {
  red: "bg-signal-red",
  amber: "bg-amber-400",
  green: "bg-emerald-500",
};

const KIND_LABEL: Record<string, string> = {
  price_cut: "Price cut",
  new_entrant: "New in area",
  hours_change: "Hours",
  own_review: "Your reviews",
  own_rating: "Your rating",
  competitor_rating: "Competitor rating",
  general: "Market",
};

type AlertStripProps = {
  alerts: MarketAlertRow[];
  // When true (dark glass aesthetic), the strip renders its own panel card;
  // legacy passes false and wraps it in its own paper-card.
  framed?: boolean;
  onChanged?: () => void;
};

// Shared by both dashboards' Monitoring tabs. Reads the market_alerts rows
// the daily cron wrote (Advise tier), newest first. Unacknowledged alerts
// expand with an "Acknowledge" action; when everything is read, the strip
// collapses to a one-line "N recent alerts" summary so the tab doesn't grow
// a permanent new block.
export function AlertStrip({ alerts, framed = true, onChanged }: AlertStripProps) {
  const acknowledge = useServerFn(acknowledgeMarketAlert);
  const unacked = alerts.filter((a) => !a.acknowledgedAt);

  if (alerts.length === 0) return null;

  const ack = async (id: string) => {
    try {
      await acknowledge({ data: { id, acknowledge: true } });
      onChanged?.();
    } catch {
      // Ack is best-effort; the row stays unacknowledged on failure.
    }
  };

  if (unacked.length === 0) {
    return (
      <div className={framed ? "rounded-md border border-rule/70 bg-card/40 p-3.5" : ""}>
        <p className="text-xs text-muted-foreground">
          {alerts.length} recent alert{alerts.length === 1 ? "" : "s"} · all read
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        framed
          ? "rounded-md border border-signal-red/30 bg-signal-red/5 p-3.5"
          : "paper-card rounded-md border border-signal-red/30 bg-signal-red/5 p-4"
      }
      role="status"
      aria-label="Market alerts"
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-widest text-signal-red">
          Alert{unacked.length === 1 ? "" : "s"} · {unacked.length} new
        </p>
        {unacked.length > 1 && (
          <button
            type="button"
            onClick={() => {
              void (async () => {
                for (const alert of unacked) await ack(alert.id);
              })();
            }}
            className="text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Acknowledge all
          </button>
        )}
      </div>
      <ul className="mt-2.5 space-y-3">
        {unacked.map((alert) => (
          <li key={alert.id} className="flex gap-2.5">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[alert.tone] ?? "bg-muted-foreground"}`} />
            <div className="min-w-0">
              <p className="text-xs font-medium leading-snug">{alert.headline}</p>
              {alert.detail && (
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{alert.detail}</p>
              )}
              <p className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                {KIND_LABEL[alert.alertKind] ?? "Market"}
                {alert.businessName ? ` · ${alert.businessName}` : ""}
                {" · "}
                {new Date(alert.createdAt).toLocaleDateString()}
              </p>
              <button
                type="button"
                onClick={() => void ack(alert.id)}
                className="mt-1 text-[11px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                Acknowledge
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Count shown as the red badge on the Monitoring tab itself.
export function unacknowledgedAlertCount(alerts: MarketAlertRow[]): number {
  return alerts.filter((a) => !a.acknowledgedAt).length;
}
