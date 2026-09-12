# theBizScope — brand & email polish checklist

Working notes for the "still says localscope / auth emails sound AI-generated"
pass. Nothing here is code — all remaining items live in third-party dashboards.

## 1. Repo & live site rebrand — VERIFIED CLEAN (Sep 12)

- `grep -rni localscope` across the repo (excl. node_modules/dist): **0 hits**.
- Live scan of `/`, `/login`, `/signup`, `/pricing`, `/dashboard`, `/terms`
  on https://thebizscope.com: **0 hits** — the deployed build is the
  rebranded one.

If "LocalScope" still shows up somewhere in the browser, it comes from one of
the dashboards below (or a stale tab — hard-refresh first).

## 2. Paddle website name → "theBizScope" (dashboard only)

The checkout header currently reads "Return to LocalScope". Paddle's API/MCP
has **no method** to read or update the approved-website profile (gap reported
to Paddle via `report_missing_tool`), so this is a 2-minute dashboard edit:

1. **Sandbox** dashboard → **Checkout** → **Website approval**
2. Edit the website **name** field → `theBizScope`
3. While there, confirm default payment link is `https://thebizscope.com/pricing`
4. Save. The checkout header updates immediately — no republish needed.

Repeat the same edit in the **live** dashboard when it's set up, before
requesting live website approval.

## 3. Supabase auth email templates (paste-ready)

The project uses **no password-reset / magic-link / invite flows in code**
(verified: no `resetPasswordForEmail`, `signInWithOtp`, or `inviteUserByEmail`
callers), so only two templates matter: **Confirm signup** and **Magic Link**
(the latter is unused today but rebranded anyway in case it gets enabled).

Paste each into **Supabase → Authentication → Emails → Templates**, replacing
the whole body. Keep `{{ .ConfirmationURL }}` exactly as written.

### Confirm signup

Subject:
```
Confirm your email — theBizScope
```

Body (HTML):
```html
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
  <p style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #b8860b; margin: 0 0 16px;">theBizScope</p>
  <h1 style="font-size: 24px; font-weight: 600; margin: 0 0 12px;">One click and your market watch begins.</h1>
  <p style="font-size: 15px; line-height: 1.6; color: #444; margin: 0 0 24px;">
    Confirm your email to activate your account. Your first weekly brief
    lands on Monday — who dropped prices, who just opened, and what to do
    about it.
  </p>
  <a href="{{ .ConfirmationURL }}"
     style="display: inline-block; background: #b8860b; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 12px 28px; border-radius: 4px;">
    Confirm my email
  </a>
  <p style="font-size: 13px; line-height: 1.6; color: #777; margin: 24px 0 0;">
    This link works once and expires in 24 hours. If you didn't create a
    theBizScope account, ignore this email — nothing else happens.
  </p>
</div>
```

### Magic Link (unused today, rebrand anyway)

Subject:
```
Your theBizScope sign-in link
```

Body (HTML):
```html
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
  <p style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #b8860b; margin: 0 0 16px;">theBizScope</p>
  <h1 style="font-size: 24px; font-weight: 600; margin: 0 0 12px;">Here to read your brief?</h1>
  <p style="font-size: 15px; line-height: 1.6; color: #444; margin: 0 0 24px;">
    Click below to sign in — no password needed.
  </p>
  <a href="{{ .ConfirmationURL }}"
     style="display: inline-block; background: #b8860b; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 12px 28px; border-radius: 4px;">
    Sign in
  </a>
  <p style="font-size: 13px; line-height: 1.6; color: #777; margin: 24px 0 0;">
    The link expires in 24 hours. If you weren't expecting it, ignore this
    email.
  </p>
</div>
```

Also update **Authentication → Emails → Templates → "Reset Password"** the
same way if/when a forgot-password flow gets built.

## 4. Sender identity

- **Supabase → Authentication → Emails → SMTP**: the default sender is
  `noreply@mail.app.supabase.io` with a basic subject style — fine for
  testing, rate-limited (~2 emails/hour on some plans) and unbranded for
  production. Before launch volume: enable **Custom SMTP** (Resend works —
  the same account as the weekly brief) and set the sender to
  `theBizScope <support@thebizscope.com>` after the domain is verified in
  Resend.
- Supabase's per-template **subject** fields also still have defaults —
  paste the subjects above.
