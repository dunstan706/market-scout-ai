# Localscope — To-do list

Everything that still needs doing, grouped by priority. Resend/email items are
quarantined at the bottom ("on hold") — see the note there before picking them
back up.

## 1. Unblock the live app (done)

- [x] **Apply the three Supabase migrations** — verified against the live
      project `gosbzrvxqwstzyhscufs` (Sep 3): `profiles`, `briefs`,
      `monitoring_snapshots`, and `waitlist_signups` all respond HTTP 200
      via the REST API, and both Block-3 columns (`briefs.emailed_at`,
      `waitlist_signups.user_id`) exist. The earlier
      "Could not save your profile" error is resolved.
- [x] **Commit & push the pending local fixes** — done in `5ecd830`
      (route-tree regeneration, `parsePrice` fixes, test-helper fixes,
      `inputValidator` → `validator`, lazy-loaded Supabase bundle).
- [x] **Decide on the `npm i` edits** to `package.json`/lockfile —
      committed in `5ecd830` (adds the missing vitest entry, npm-registry
      URLs).

## 2. Verify the product loop live

- [x] `npm run typecheck`, `npm test` (57/57), and `npm run build` all pass
      (verified in the agent workspace, Sep 3).
- [ ] Sign up → save profile → **Run scan now** (first scan sets the baseline)
      → run scan again later → check the "What changed" panel shows real deltas.
- [ ] Confirm the API keys are set in Lovable Cloud:
      `GOOGLE_PLACES_API_KEY` — confirmed (encrypted project secret, Sep 3).
      `SUPABASE_SERVICE_ROLE_KEY` and `LOVABLE_API_KEY` are reserved prefixes
      Lovable auto-manages — verify they appear under More → Cloud → Secrets
      (marked "Lovable").
- [ ] Test waitlist → account claim: join the waitlist with an email, then sign
      up with that same email — the dashboard profile should auto-prefill.
- [ ] Trigger the weekly run once manually:
      `curl -X POST <host>/api/cron/run-monitoring -H "Authorization: Bearer $LOVABLE_CRON_SECRET"`
      and confirm profiles are processed and briefs are stored (the JSON
      response reports `processed` / `failed` counts). This works without
      email configured.
- [ ] Swap the relative `og:image` URL for an absolute one once the domain is
      known (marked with a TODO in `src/routes/index.tsx`).
- [ ] Review the draft legal copy on `/privacy` and `/terms` before launch.

## 3. Product backlog (after validation)

- [ ] Stripe billing / paid plans (deliberately deferred until demand is proven).
- [ ] **Multi-business support** (design agreed in discussion, not built yet):
      business-first dashboard rail — add businesses, click one to swap the
      main panel, with **Details / Monitoring / Run scan** shown as tabs;
      each business keeps its own scan history and briefs. Requires a
      `businesses` table migration + linking snapshots/briefs by
      `business_id`, server-fn rework, and cron per business. Decisions so
      far:
      - "Details" naming agreed for the first tab.
      - All businesses share one weekly run cadence for now (per-business
        schedules later).
      - No delete-business UX in v1 (revisit when plans/downgrades exist).
      - Tier caps when billing lands: **$15 plan = 1 business, $50 plan =
        up to 5, Enterprise ("ask for a quote") = unlimited**.
      - Until billing: free accounts soft-cap at 1 business, but the
        "Add a new Business" button **stays visible** and routes to an
        **upgrade/plan page** — build that page later (see Stripe item
        above); it's where the $15/$50/Enterprise tiers get presented.
- [ ] The owner's own review signal — the "green" opportunity signal about
      *their* business, not just competitors.
- [ ] Watching for brand-new buildings / closures — intentionally not claimed
      yet: closures are skipped because scan noise makes them unreliable, and
      new entries are only reported after a baseline exists.
- [ ] Shared rate-limit + cache store (Supabase) if the app ever runs more than
      one instance — both are in-memory today (noted in
      `rate-limit.server.ts` and `cache.server.ts`).

## 4. Housekeeping

- [ ] Keep `.env` committed — Lovable requires it for build-time `VITE_*`
      values (gitignoring it breaks previews). Rule going forward: private
      keys go in Lovable Secrets (More → Cloud → Secrets), never in `.env`.
      The tracked file holds only publishable Supabase values today.

## On hold — Resend email delivery (set aside for now)

- [ ] Set `RESEND_API_KEY` and verify a `RESEND_FROM` sender in Resend.
- [ ] Trigger the cron endpoint once and confirm a brief lands in an inbox.
- [ ] Schedule the weekly job (e.g., Monday ~08:00) on the host.
      (`.env.example` already documents `RESEND_API_KEY`, `RESEND_FROM`,
      `LOVABLE_CRON_SECRET`; the cron endpoint already sends + stamps
      `emailed_at` so retries never double-send — the code is done, only the
      keys and schedule are missing.)
