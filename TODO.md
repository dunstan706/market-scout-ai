# Localscope — To-do list

Everything that still needs doing, grouped by priority. Resend/email items are
quarantined at the bottom ("on hold") — see the note there before picking them
back up.

## 1. Unblock the live app (blocking)

- [ ] **Apply the three Supabase migrations** — the SQL for each is in the chat
      history (or use `npx supabase db push` after `npx supabase link`):
      1. `profiles` + `briefs` tables (RLS + grants)
      2. `monitoring_snapshots` table (RLS + grants)
      3. `briefs.emailed_at` + `waitlist_signups.user_id` (partly for email,
         but the `user_id` column is also what powers waitlist → account claim)
      Until these run, "Could not save your profile" keeps failing — the tables
      don't exist in the Supabase project yet.
- [ ] **Commit & push the pending local fixes** — route-tree regeneration,
      `parsePrice` fixes (€9,50 / INR 1,200), brief-title double space,
      `inputValidator` → `validator` deprecations, and the lazy-loaded
      Supabase bundle (landing chunk 563 kB → 350 kB).
- [ ] **Decide on the `npm i` edits** to `package.json`/`package-lock.json`
      (npm normalized the vite version to a caret) — commit them or revert.

## 2. Verify the product loop live

- [x] `npm run typecheck`, `npm test` (57/57), and `npm run build` all pass
      (verified in the agent workspace, Sep 3).
- [ ] Sign up → save profile → **Run scan now** (first scan sets the baseline)
      → run scan again later → check the "What changed" panel shows real deltas.
- [ ] Confirm the API keys are set in Lovable Cloud: `SUPABASE_SERVICE_ROLE_KEY`,
      `GOOGLE_PLACES_API_KEY`, `LOVABLE_API_KEY` (all documented in
      `.env.example`).
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
- [ ] The owner's own review signal — the "green" opportunity signal about
      *their* business, not just competitors.
- [ ] Watching for brand-new buildings / closures — intentionally not claimed
      yet: closures are skipped because scan noise makes them unreliable, and
      new entries are only reported after a baseline exists.
- [ ] Shared rate-limit + cache store (Supabase) if the app ever runs more than
      one instance — both are in-memory today (noted in
      `rate-limit.server.ts` and `cache.server.ts`).

## 4. Housekeeping

- [ ] Untrack `.env` and add it to `.gitignore` (`git rm --cached .env`) so
      credentials added there can never be committed. It is tracked today from
      an early commit but holds only publishable Supabase keys — no secrets in
      history.

## On hold — Resend email delivery (set aside for now)

- [ ] Set `RESEND_API_KEY` and verify a `RESEND_FROM` sender in Resend.
- [ ] Trigger the cron endpoint once and confirm a brief lands in an inbox.
- [ ] Schedule the weekly job (e.g., Monday ~08:00) on the host.
      (`.env.example` already documents `RESEND_API_KEY`, `RESEND_FROM`,
      `LOVABLE_CRON_SECRET`; the cron endpoint already sends + stamps
      `emailed_at` so retries never double-send — the code is done, only the
      keys and schedule are missing.)
