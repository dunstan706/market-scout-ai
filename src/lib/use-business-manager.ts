"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  claimWaitlistProfile,
  createBusiness,
  deleteBusiness,
  getBillingStatus,
  listBusinesses,
  saveBusiness,
  PLAN_BUSINESS_LIMITS,
  type BillingStatus,
  type Business,
  type PlanTier,
  type Profile,
} from "@/lib/account.functions";

// The one owner of business data and mutations. Both dashboards (globe and
// legacy) render from this hook, so the add/save/delete flows, the tier gate
// and the delete-confirm machine can never drift apart again — a fix lands
// here once and applies to both.
//
// Contract:
// - Mutations throw on failure; the caller catches and shows the message in
//   its own UI. The hook's store only changes on success.
// - `load()` runs once per mount (waitlist claim, self-heal reseed, billing).
// - Delete is two-step by design: `armDelete` → `remove` → auto-disarm, and
//   arming never survives a business switch.

export type TierGate = {
  tier: PlanTier;
  /** Business allowance for the tier (free 0, watch 1, advise 5, expand ∞). */
  limit: number;
  /** True when another business may be added right now. */
  canAddMore: boolean;
  /** True when the account is at (or over) its cap — show plans, not a form. */
  atCap: boolean;
};

export function useBusinessManager({ auto = true }: { auto?: boolean } = {}) {
  const fetchBusinesses = useServerFn(listBusinesses);
  const addBusinessFn = useServerFn(createBusiness);
  const saveBusinessFn = useServerFn(saveBusiness);
  const deleteBusinessFn = useServerFn(deleteBusiness);
  const claimProfile = useServerFn(claimWaitlistProfile);
  const fetchBilling = useServerFn(getBillingStatus);

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  // Two-step delete confirmation, shared so both dashboards behave the same.
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Initial load settled (success or not) — dashboards gate their skeletons
  // and the globe's first paint on this.
  const [loaded, setLoaded] = useState(false);
  const loadStarted = useRef(false);

  const activeBusiness = businesses.find((b) => b.id === activeId) ?? businesses[0] ?? null;

  // One-time load: businesses (with waitlist claim + reseed fallback), then
  // billing. Returns the resolved businesses + billing so hosts can sequence
  // their own reactions (draft seeding, auto-opening the plans overlay)
  // without reading stale state from the same closure.
  const load = useCallback(
    async (): Promise<{ businesses: Business[]; billing: BillingStatus | null }> => {
      let resolved: Business[] = [];
      let resolvedBilling: BillingStatus | null = null;
      try {
        let { businesses: owned } = await fetchBusinesses();
        // No business yet — claim a waitlist signup if this email has one; the
        // claim seeds a real businesses row, so read it back for the id.
        if (owned.length === 0) {
          const claimed = await claimProfile();
          if (claimed.profile) {
            const reread = await fetchBusinesses();
            owned = reread.businesses;
          }
        }
        resolved = owned;
        setBusinesses(owned);
        setActiveId((current) => current ?? owned[0]?.id ?? null);

        try {
          const { status } = await fetchBilling();
          resolvedBilling = status;
          setBilling(status);
        } catch {
          // Billing check unavailable — never block the dashboard for it.
        }
      } catch {
        // Signed out, expired, or schema not ready — dashboards render their
        // empty states and every action re-checks server-side anyway.
      } finally {
        setLoaded(true);
      }
      return { businesses: resolved, billing: resolvedBilling };
    },
    [fetchBusinesses, claimProfile, fetchBilling],
  );

  useEffect(() => {
    if (!auto) return;
    if (loadStarted.current) return; // Strict double-invoke guard
    loadStarted.current = true;
    void load();
  }, [auto, load]);

  const select = useCallback((id: string) => {
    setActiveId(id);
    setConfirmDelete(false); // confirmations never carry across businesses
  }, []);

  // Adds a business (tier-capped server-side). Throws with a user-facing
  // message; on success the new business becomes active.
  const add = useCallback(
    async (draft: Profile): Promise<Business> => {
      const { business } = await addBusinessFn({ data: draft });
      setBusinesses((prev) => [...prev, business]); // multi-business: append
      setActiveId(business.id);
      setConfirmDelete(false);
      return business;
    },
    [addBusinessFn],
  );

  // Saves edits to the active business and reflects them in the store.
  const save = useCallback(
    async (businessId: string, draft: Profile): Promise<void> => {
      await saveBusinessFn({ data: { ...draft, businessId } });
      setBusinesses((prev) =>
        prev.map((b) =>
          b.id === businessId
            ? {
                ...b,
                businessName: draft.businessName,
                businessType: draft.businessType,
                location: draft.location,
                pricePoint: draft.pricePoint,
              }
            : b,
        ),
      );
    },
    [saveBusinessFn],
  );

  // Deletes a business (history and briefs cascade server-side). On success
  // the next remaining business becomes active, or null when none remain.
  // Returns the remaining businesses so hosts can seed their forms from the
  // new selection (or pick their "none left" screen) without stale reads.
  const remove = useCallback(
    async (businessId: string): Promise<Business[]> => {
      await deleteBusinessFn({ data: businessId });
      const remaining = businesses.filter((b) => b.id !== businessId);
      setBusinesses(remaining);
      setActiveId((current) => (current === businessId ? remaining[0]?.id ?? null : current));
      setConfirmDelete(false);
      return remaining;
    },
    [businesses, deleteBusinessFn],
  );

  const armDelete = useCallback(() => setConfirmDelete(true), []);
  const disarmDelete = useCallback(() => setConfirmDelete(false), []);

  // Dev/testing escape hatch: hard-sets the store (the globe dashboard's
  // __devBusiness aid exercises the mark flow without auth). Never called
  // from product flows.
  const devSet = useCallback((list: Business[], active: string | null) => {
    setBusinesses(list);
    setActiveId(active);
  }, []);

  const tier: PlanTier = billing?.planTier ?? "free";
  const tierGate: TierGate = {
    tier,
    limit: PLAN_BUSINESS_LIMITS[tier],
    canAddMore: businesses.length < PLAN_BUSINESS_LIMITS[tier],
    atCap: businesses.length >= PLAN_BUSINESS_LIMITS[tier],
  };

  return {
    // Data
    businesses,
    activeId,
    activeBusiness,
    billing,
    loaded,
    tierGate,
    // Lifecycle
    load,
    select,
    // Mutations (throw on failure — caller renders the message)
    add,
    save,
    remove,
    // Delete confirmation machine
    confirmDelete,
    armDelete,
    disarmDelete,
    // Dev/testing only
    devSet,
  };
}
