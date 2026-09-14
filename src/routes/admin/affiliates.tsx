import { createFileRoute, Navigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  listAffiliateApplications,
  recordAffiliatePayout,
  setAffiliateStatus,
  type AdminAffiliateRow,
} from "@/lib/affiliate.functions";

// Payout console for the site owner. Admins are designated by ADMIN_EMAILS
// (comma-separated env var) and verified server-side on every call — the
// page itself only decides what to render. Monthly routine: review pending
// applications, approve, then "Pay out" each affiliate with room in
// available balance; the ledger (not the form) computes the amount.

export const Route = createFileRoute("/admin/affiliates")({
  head: () => ({
    meta: [{ title: "Affiliate admin — theBizScope" }],
  }),
  component: AdminAffiliatesPage,
});

function fmtMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

const STATUS_STYLES: Record<string, string> = {
  pending: "text-amber-300",
  approved: "text-accent",
  suspended: "text-signal-red",
};

function AdminAffiliatesPage() {
  const router = useRouter();
  const fetchRows = useServerFn(listAffiliateApplications);
  const updateStatus = useServerFn(setAffiliateStatus);
  const payOut = useServerFn(recordAffiliatePayout);

  const [authChecked, setAuthChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<AdminAffiliateRow[]>([]);
  const [loadError, setLoadError] = useState("");

  const [busyId, setBusyId] = useState<string | null>(null);
  const [payoutFor, setPayoutFor] = useState<string | null>(null);
  const [payoutRef, setPayoutRef] = useState("");
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);

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
        const result = await fetchRows();
        if (cancelled) return;
        setIsAdmin(result.isAdmin);
        setRows(result.rows);
      } catch (err) {
        // assertAdmin throws for non-admins — show the gate, not a stack trace.
        setLoadError(err instanceof Error ? err.message : "Could not load the affiliate ledger.");
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchRows]);

  async function refresh() {
    try {
      const result = await fetchRows();
      setIsAdmin(result.isAdmin);
      setRows(result.rows);
      setLoadError("");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not reload.");
    }
  }

  async function onSetStatus(affiliateId: string, status: "approved" | "suspended" | "pending") {
    setBusyId(affiliateId);
    setFlash(null);
    try {
      await updateStatus({ data: { affiliateId, status } });
      await refresh();
      setFlash({ ok: true, message: `Affiliate marked ${status}.` });
    } catch (err) {
      setFlash({ ok: false, message: err instanceof Error ? err.message : "Update failed." });
    } finally {
      setBusyId(null);
    }
  }

  async function onPayout(affiliateId: string) {
    setBusyId(affiliateId);
    setFlash(null);
    try {
      const result = await payOut({ data: { affiliateId, ...(payoutRef.trim() ? { reference: payoutRef.trim() } : {}) } });
      setPayoutFor(null);
      setPayoutRef("");
      await refresh();
      setFlash({
        ok: true,
        message: `Payout recorded: ${fmtMoney(result.amount)} across ${result.commissionCount} commission${result.commissionCount === 1 ? "" : "s"}. Send the transfer, keep the receipt.`,
      });
    } catch (err) {
      setFlash({ ok: false, message: err instanceof Error ? err.message : "Payout failed." });
    } finally {
      setBusyId(null);
    }
  }

  async function onSignOut() {
    await supabase.auth.signOut();
    await router.navigate({ to: "/" });
  }

  if (authChecked && !signedIn) {
    return <Navigate to="/login" />;
  }

  if (authChecked && signedIn && !isAdmin) {
    return (
      <main className="theme-dark flex min-h-screen items-center justify-center px-4">
        <div className="paper-card max-w-md rounded-md p-7 text-center">
          <p className="eyebrow">Affiliate admin</p>
          <p className="mt-3 text-sm text-muted-foreground">{loadError || "Admin access required."}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="theme-dark relative min-h-screen w-full overflow-y-auto">
      <div className="relative z-10 mx-auto max-w-4xl px-6 py-14">
        <div className="rule-double pt-6">
          <p className="eyebrow">Internal</p>
          <h1 className="mt-2 font-serif text-3xl md:text-4xl">Affiliate payouts</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Approve applications, then run payouts monthly. Amounts are computed from the
            commission ledger — the ledger is the source of truth.
          </p>
        </div>

        {flash && (
          <p className={`mt-4 text-sm ${flash.ok ? "text-accent" : "text-signal-red"}`}>{flash.message}</p>
        )}

        <div className="mt-8 space-y-4">
          {rows.length === 0 && authChecked && isAdmin && (
            <p className="text-sm text-muted-foreground">No affiliate applications yet.</p>
          )}
          {rows.map((a) => (
            <div key={a.id} className="paper-card rounded-md p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="font-serif text-lg">
                    {a.name || a.email}{" "}
                    <span className="ml-1 font-mono text-xs text-muted-foreground">/{a.code}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a.email} · joined {new Date(a.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {a.payoutEmail && a.payoutEmail !== a.email ? ` · pays to ${a.payoutEmail}` : ""}
                  </p>
                </div>
                <span className={`text-sm font-medium ${STATUS_STYLES[a.status] ?? ""}`}>{a.status}</span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Referrals</dt>
                  <dd className="mt-0.5 text-foreground">
                    {a.referralCount} ({a.convertedCount} paying)
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Earned</dt>
                  <dd className="mt-0.5 text-foreground">{fmtMoney(a.earned)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Payable now</dt>
                  <dd className="mt-0.5 font-serif text-lg text-accent">{fmtMoney(a.payable)}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {a.status === "pending" && (
                  <button
                    type="button"
                    disabled={busyId === a.id}
                    onClick={() => onSetStatus(a.id, "approved")}
                    className="rounded-sm border border-accent/60 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                  >
                    Approve
                  </button>
                )}
                {a.status === "approved" && (
                  <>
                    <button
                      type="button"
                      disabled={busyId === a.id || a.payable < 25}
                      onClick={() => setPayoutFor(payoutFor === a.id ? null : a.id)}
                      className="rounded-sm border border-accent/60 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                    >
                      {a.payable < 25 ? `Payable at $25 (${fmtMoney(a.payable)})` : "Pay out"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => onSetStatus(a.id, "suspended")}
                      className="rounded-sm border border-rule px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-signal-red hover:text-signal-red disabled:opacity-50"
                    >
                      Suspend
                    </button>
                  </>
                )}
                {a.status === "suspended" && (
                  <button
                    type="button"
                    disabled={busyId === a.id}
                    onClick={() => onSetStatus(a.id, "approved")}
                    className="rounded-sm border border-rule px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    Reinstate
                  </button>
                )}
              </div>

              {payoutFor === a.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-sm border border-rule/80 bg-card/40 p-3">
                  <input
                    className="min-w-0 flex-1 rounded-sm border border-rule/80 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent/70 focus:outline-none"
                    type="text"
                    placeholder="Transfer reference (optional — e.g. bank receipt #)"
                    value={payoutRef}
                    onChange={(e) => setPayoutRef(e.target.value)}
                    maxLength={120}
                  />
                  <button
                    type="button"
                    disabled={busyId === a.id}
                    onClick={() => onPayout(a.id)}
                    className="rounded-sm border border-accent/60 bg-accent/20 px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/30 disabled:opacity-50"
                  >
                    {busyId === a.id ? "Recording…" : `Record ${fmtMoney(a.payable)} payout`}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-10 flex justify-between border-t border-rule pt-4 text-xs text-muted-foreground">
          <a href="/dashboardtest" className="underline decoration-rule underline-offset-2 hover:text-foreground">
            Back to dashboard
          </a>
          <button type="button" onClick={onSignOut} className="underline decoration-rule underline-offset-2 hover:text-foreground">
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
