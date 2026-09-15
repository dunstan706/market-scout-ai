import { createFileRoute, Link, Navigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ConstellationGrid } from "@/components/ConstellationGrid";
import { AnimatedNavFramer } from "@/components/ui/animated-nav-framer";
import {
  applyForAffiliateProgram,
  getMyAffiliation,
  type AffiliateCommissionRow,
  type AffiliateStats,
} from "@/lib/affiliate.functions";

// Affiliate program page. Two states: visitors see the pitch + application
// form; accepted/pending affiliates see their referral link, earnings, and
// history. Commission rules live in the affiliate terms (linked at the
// bottom) — this page surfaces the data, the ledger lives in the database.

export const Route = createFileRoute("/affiliates")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Affiliates — theBizScope" },
      {
        name: "description",
        content: "Earn 10% of every subscription payment you refer to theBizScope, for the first 12 months.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AffiliatesPage,
});

function fmtMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const COMMISSION_STATUS: Record<AffiliateCommissionRow["status"], { label: string; cls: string }> = {
  pending: { label: "maturing", cls: "text-muted-foreground" },
  available: { label: "available", cls: "text-accent" },
  paid: { label: "paid", cls: "text-foreground" },
  reversed: { label: "reversed", cls: "text-signal-red" },
};

// Six calendar buckets (current month last) for the earnings chart, summed
// from the commission ledger the panel already loads. Reversed commissions
// are excluded, matching the lifetime-earned total.
function monthlyEarnings(commissions: AffiliateCommissionRow[], months = 6) {
  const now = new Date();
  const buckets: Array<{ key: string; label: string; amount: number }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      amount: 0,
    });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const c of commissions) {
    if (c.status === "reversed") continue;
    const d = new Date(c.createdAt);
    const bucket = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (bucket) bucket.amount += c.amount;
  }
  return buckets;
}

// Chart value labels sit in six narrow columns — compact notation above $999.
function fmtChartMoney(amount: number): string {
  if (amount >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  }
  return fmtMoney(amount);
}

function AffiliatesPage() {
  const router = useRouter();
  const fetchStats = useServerFn(getMyAffiliation);
  const apply = useServerFn(applyForAffiliateProgram);

  const [authChecked, setAuthChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [stats, setStats] = useState<AffiliateStats | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [payoutEmail, setPayoutEmail] = useState("");
  const [promo, setPromo] = useState("");
  const [applying, setApplying] = useState(false);
  const [appError, setAppError] = useState("");

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session?.user) {
        setAuthChecked(true);
        return;
      }
      setSignedIn(true);
      try {
        const next = await fetchStats();
        if (!cancelled) setStats(next);
        if (next.affiliate) {
          setName((n) => n || next.affiliate?.name || "");
          setEmail((e) => e || next.affiliate?.email || "");
        }
      } catch {
        // stats load failure leaves the placeholder
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchStats]);

  async function onApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setApplying(true);
    setAppError("");
    try {
      await apply({
        data: {
          name: name.trim(),
          email: email.trim(),
          ...(payoutEmail.trim() ? { payoutEmail: payoutEmail.trim() } : {}),
          ...(promo.trim() ? { promoMethod: promo.trim() } : {}),
        },
      });
      setStats(await fetchStats());
    } catch (err) {
      setAppError(err instanceof Error && err.message ? err.message : "Could not submit your application.");
    } finally {
      setApplying(false);
    }
  }

  async function onCopyLink() {
    if (!stats?.referralLink) return;
    try {
      await navigator.clipboard.writeText(stats.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the link is still selectable below the button.
    }
  }

  async function onSignOut() {
    await supabase.auth.signOut();
    await router.navigate({ to: "/" });
  }

  if (authChecked && !signedIn) {
    return <Navigate to="/login" />;
  }

  const affiliate = stats?.affiliate ?? null;
  const inputCls =
    "w-full rounded-sm border border-rule/80 bg-card/50 px-3.5 py-3 text-sm text-foreground backdrop-blur-sm transition-colors placeholder:text-muted-foreground/60 focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20";

  return (
    <main className="theme-dark relative h-screen w-full overflow-y-auto">
      <ConstellationGrid className="fixed inset-0 h-screen w-full" warp={false} glowRadius={85} />

      <AnimatedNavFramer
        collapsible={false}
        logo={
          <Link to="/" className="whitespace-nowrap font-serif text-xl tracking-tight sm:text-2xl">
            theBizScope<span className="text-accent">.</span>
          </Link>
        }
        items={[
          { name: "Dashboard", href: "/dashboardtest" },
          { name: "Profile", href: "/profile" },
          { name: "Sign out", onClick: onSignOut, danger: true },
        ]}
      />

      <div className="relative z-10 flex min-h-full items-center justify-center px-4 py-24">
        <div className="paper-card animate-rise w-full max-w-xl rounded-md p-7 shadow-lift md:p-8">
          <p className="eyebrow">Affiliates</p>
          <h1 className="mt-2 font-serif text-3xl">Share theBizScope, earn 10%.</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Every subscription payment from a customer you refer pays you 10% — for the first
            12 months of their plan. Payouts run monthly once your balance passes $25.
          </p>

          {!affiliate && (
            <form onSubmit={onApply} className="mt-6 space-y-3 border-t border-rule pt-5" noValidate>
              <p className="text-sm text-foreground">Apply to join the program.</p>
              <input
                className={inputCls}
                type="text"
                placeholder="Your name or business"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
              />
              <input
                className={inputCls}
                type="email"
                placeholder="Contact email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                className={inputCls}
                type="email"
                placeholder="Payout email (optional — defaults to contact email)"
                value={payoutEmail}
                onChange={(e) => setPayoutEmail(e.target.value)}
              />
              <textarea
                className={`${inputCls} min-h-20`}
                placeholder="How do you plan to spread the word? (optional)"
                value={promo}
                onChange={(e) => setPromo(e.target.value)}
                maxLength={500}
              />
              {appError && <p className="text-sm text-signal-red">{appError}</p>}
              <button
                type="submit"
                disabled={applying || name.trim().length < 2 || !email.trim()}
                className="w-full rounded-sm border border-accent/60 bg-accent/10 px-4 py-3 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
              >
                {applying ? "Submitting…" : "Apply to become an affiliate"}
              </button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Applications are reviewed by hand — usually within a day or two. Self-referrals
                don't earn commissions. See the{" "}
                <Link to="/terms" className="underline decoration-rule underline-offset-2 hover:text-foreground">
                  affiliate terms
                </Link>
                .
              </p>
            </form>
          )}

          {affiliate && affiliate.status === "pending" && (
            <div className="mt-6 border-t border-rule pt-5">
              <p className="text-sm text-foreground">
                Application received — you're in the review queue.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Once approved, your referral link goes live on this page and every subscription
                payment from customers who sign up through it starts earning. You signed up as{" "}
                <span className="text-foreground">{affiliate.email}</span>.
              </p>
            </div>
          )}

          {affiliate && affiliate.status === "suspended" && (
            <div className="mt-6 border-t border-rule pt-5">
              <p className="text-sm text-signal-red">This affiliate account is suspended.</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                New commissions are paused. Contact support@thebizscope.com if you think this is
                a mistake.
              </p>
            </div>
          )}

          {affiliate && affiliate.status === "approved" && (
            <div className="mt-6 space-y-6 border-t border-rule pt-5">
              <div>
                <p className="eyebrow">Your link</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-sm border border-rule/80 bg-card/50 px-3 py-2 font-mono text-xs text-foreground">
                    {stats?.referralLink ?? "…"}
                  </code>
                  <button
                    type="button"
                    onClick={onCopyLink}
                    className="rounded-sm border border-rule px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Anyone who signs up after clicking your link is yours — first click wins, and
                  they stay attributed to you permanently.
                </p>
              </div>

              <div>
                <p className="eyebrow">Earnings</p>
                <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-sm border border-accent/40 bg-accent/5 px-3 py-3 sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">Lifetime earned</dt>
                    <dd className="mt-0.5 font-serif text-2xl">{fmtMoney(stats?.totals.earned ?? 0)}</dd>
                  </div>
                  <div className="rounded-sm border border-rule/80 bg-card/40 px-3 py-2.5">
                    <dt className="text-xs text-muted-foreground">Last 30 days</dt>
                    <dd className="mt-0.5 font-serif text-lg">{fmtMoney(stats?.totals.recent30 ?? 0)}</dd>
                  </div>
                  <div className="rounded-sm border border-rule/80 bg-card/40 px-3 py-2.5">
                    <dt className="text-xs text-muted-foreground">Available</dt>
                    <dd className="mt-0.5 font-serif text-lg">{fmtMoney(stats?.totals.available ?? 0)}</dd>
                  </div>
                  <div className="rounded-sm border border-rule/80 bg-card/40 px-3 py-2.5">
                    <dt className="text-xs text-muted-foreground">Maturing</dt>
                    <dd className="mt-0.5 font-serif text-lg">{fmtMoney(stats?.totals.pending ?? 0)}</dd>
                  </div>
                  <div className="rounded-sm border border-rule/80 bg-card/40 px-3 py-2.5">
                    <dt className="text-xs text-muted-foreground">Paid out</dt>
                    <dd className="mt-0.5 font-serif text-lg">{fmtMoney(stats?.totals.paid ?? 0)}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">
                  Commissions mature 30 days after each payment (refund protection), then become
                  payable on the next monthly payout run.
                </p>
              </div>

              {stats && (
                <div>
                  <p className="eyebrow">Last 6 months</p>
                  {(() => {
                    const months = monthlyEarnings(stats.commissions);
                    const max = Math.max(...months.map((m) => m.amount));
                    const currentKey = months[months.length - 1]?.key ?? "";
                    return (
                      <>
                        <div className="mt-3 flex h-32 items-end gap-1.5 border-b border-rule/70 sm:gap-3">
                          {months.map((m) => (
                            <div
                              key={m.key}
                              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                            >
                              {m.amount > 0 && (
                                <span className="text-[11px] leading-none text-foreground">
                                  {fmtChartMoney(m.amount)}
                                </span>
                              )}
                              <div
                                title={`${m.label} — ${fmtMoney(m.amount)}`}
                                style={{
                                  height: m.amount > 0 ? `${Math.max(6, (m.amount / max) * 75)}%` : "2px",
                                }}
                                className={`w-full max-w-9 rounded-t-sm transition-colors ${
                                  m.amount > 0
                                    ? m.key === currentKey
                                      ? "bg-accent"
                                      : "bg-accent/60 hover:bg-accent"
                                    : "bg-rule/60"
                                }`}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="mt-1.5 flex gap-1.5 sm:gap-3">
                          {months.map((m) => (
                            <span
                              key={m.key}
                              className="flex-1 text-center text-xs text-muted-foreground"
                            >
                              {m.label}
                            </span>
                          ))}
                        </div>
                        {max === 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            No commission activity in the last 6 months yet.
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              <div>
                <p className="eyebrow">Commissions</p>
                {stats && stats.commissions.length > 0 ? (
                  <>
                    <ul className="mt-2 divide-y divide-rule/70 rounded-sm border border-rule/80">
                      {stats.commissions.slice(0, 25).map((c) => {
                        const status = COMMISSION_STATUS[c.status];
                        const label =
                          stats.referrals.find((x) => x.userId === c.referredUserId)?.email ??
                          "Signed up";
                        return (
                          <li
                            key={c.id}
                            className="flex items-baseline justify-between gap-4 px-3 py-2.5 text-sm"
                          >
                            <span className="min-w-0 truncate text-muted-foreground">
                              {label} · payment {c.paymentNumber} · {fmtDate(c.createdAt)}
                            </span>
                            <span className={`shrink-0 ${status.cls}`}>
                              {fmtMoney(c.amount, c.currencyCode)}
                              <span className="ml-2 text-xs">{status.label}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {stats.commissions.length > 25 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Showing the 25 most recent of {stats.commissions.length} commissions.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No commissions yet — each payment from a paying referral lands here.
                  </p>
                )}
              </div>

              {stats && stats.referrals.length > 0 && (
                <div>
                  <p className="eyebrow">
                    Your referrals ({stats.referralCount} total · {stats.convertedCount} paying)
                  </p>
                  <ul className="mt-2 divide-y divide-rule/70 rounded-sm border border-rule/80">
                    {stats.referrals.slice(0, 20).map((r) => {
                      const earned = stats.referralEarnings[r.userId] ?? 0;
                      return (
                        <li
                          key={r.id}
                          className="flex items-baseline justify-between gap-4 px-3 py-2.5 text-sm"
                        >
                          <span className="truncate text-muted-foreground">{r.email ?? "Signed up"}</span>
                          {r.converted ? (
                            <span className="shrink-0 text-foreground">
                              {fmtMoney(earned)}
                              <span className="ml-2 text-xs text-muted-foreground">earned</span>
                            </span>
                          ) : (
                            <span className="shrink-0 text-muted-foreground">signed up</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {stats.referrals.length > 20 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Showing the 20 most recent of {stats.referrals.length}.
                    </p>
                  )}
                </div>
              )}

              {stats && stats.payouts.length > 0 && (
                <div>
                  <p className="eyebrow">Payouts</p>
                  <ul className="mt-2 divide-y divide-rule/70 rounded-sm border border-rule/80">
                    {stats.payouts.map((p) => (
                      <li key={p.id} className="flex items-baseline justify-between gap-4 px-3 py-2.5 text-sm">
                        <span className="text-muted-foreground">{fmtDate(p.paidAt)}</span>
                        <span className="text-foreground">
                          {fmtMoney(p.amount, p.currencyCode)}
                          {p.reference ? <span className="ml-2 text-xs text-muted-foreground">{p.reference}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <p className="mt-8 border-t border-rule pt-4 text-xs text-muted-foreground">
            Questions? support@thebizscope.com ·{" "}
            <Link to="/terms" className="underline decoration-rule underline-offset-2 hover:text-foreground">
              Affiliate terms
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
