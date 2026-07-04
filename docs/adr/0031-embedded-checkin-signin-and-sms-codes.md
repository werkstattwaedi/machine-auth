# ADR-0031: Embedded check-in sign-in and SMS login codes via Firebase phone auth

**Status:** Accepted

**Date:** 2026-07-03

## Context

The check-in step of the self-checkout presented the guest form by default,
with account sign-in hidden behind a sub-link ("Kein Badge dabei? Mit
E-Mail-Code anmelden" on the kiosk, "Anmelden oder registrieren" → `/login`
in the browser). Members regularly checked out as guests and paid the guest
tariff because the account path was not discoverable.

The design handoff "Kiosk sign-in flow redesign" (2026-07, surfaces 3a
desktop-kiosk / 3b mobile) makes the choice explicit: a segmented
**"Mit Konto anmelden" / "Als Gast"** switcher (account first and default), a
single identifier field that auto-detects **e-mail vs. phone number**, code
entry in a **modal dialog**, and — once signed in — the existing "Deine
Angaben" view. SMS codes are part of the design but ship as a second step,
for users with a verified mobile number on their profile.

Constraints that shaped the decision:

- **Two session flavors already exist** (ADR-0022): kiosk code sign-in mints
  the same ephemeral synthetic `actsAs` session as a badge tap
  (`verifyLoginCodeKiosk`), while `/login` mints a persistent session.
  Embedding "the login flow" into check-in must not collapse that
  distinction.
- Google sign-in exists on `/login` and must survive; it makes no sense on
  a shared kiosk PC (persistent Google session, popup auth in Electron).
- The login-code backend (`loginCodes`, rate limits, Resend delivery) is
  e-mail-only end-to-end; there is no SMS provider anywhere in the repo,
  `users.phone` is free-text, unverified, non-unique and never read.

## Decision

**1. Check-in hosts the login flow; the surface decides the session.**
`/checkin` renders the switcher (account default; guest when the roster
already carries data) and an embedded account section
(`checkin-signin.tsx`):

- identifier field with inline submit arrow, disabled until a channel is
  detected (`detectChannel`; phone detection gated behind an `smsEnabled`
  flag, default off until step 2),
- code entry and sign-up as **dialogs**, not inline stages,
- **kiosk**: `verifyLoginCodeKiosk` → `establishKioskSession` (ephemeral,
  ADR-0022 unchanged), NFC affordance below the "oder" divider, no Google,
  no sign-up ("register on your own device"),
- **own device**: the regular persistent login (`verifyLoginCode`), Google
  button below the divider, unknown e-mail opens the existing sign-up form
  (`SignupFields`) in a dialog. A Google-new principal completes sign-up in
  the same dialog (`completeSignedInSignup`); abandoning it signs out again
  so no doc-less half-session leaks into the wizard.

Sign-in transitions in place — no full-page reload: the wizard's existing
pre-fill machinery (`usePreFillPerson`, kiosk token store) already handles a
mid-page identity change. `/login` stays as-is for direct links and account
pages; shared pieces were extracted (`GoogleSignInButton`,
`requestCodeWithThrottle`) instead of duplicated.

**2. SMS login codes ride on Firebase Auth's phone provider** (step 2, not a
custom SMS integration):

- profile verification via `linkWithPhoneNumber` on `/account/profile`
  (verified self-service; Firebase enforces one-account-per-phone and phone
  sign-in lands on the same uid as the e-mail account),
- own device: `signInWithPhoneNumber` + invisible reCAPTCHA, code confirmed
  client-side,
- kiosk: after `confirm(code)`, a small `exchangeForKioskSession` callable
  swaps the ID token for the ephemeral `actsAs` custom token and the client
  signs out of the phone session — preserving ADR-0022 semantics,
- scope: check-in first; converting `/login` is a follow-up; the admin app
  stays e-mail-only.

**3. The kiosk footer keeps** the "Besuch starten" / "Material erfassen"
logic from #465/#467 (restyled); the handoff's single "Weiter" applies to
the non-kiosk footer only, and is disabled while the account section is
active without a sign-in (nothing to advance with; enabling it would
validate the hidden guest form).

## Consequences

**Pros:**
- Member sign-in is a first-class, discoverable path; member pricing is
  called out at the moment of choice ("nur so gelten die Mitglieder-Preise").
- One shared component serves kiosk and personal devices; only the verify
  endpoint and the Google/sign-up affordances differ by the kiosk flag.
- SMS verification, uniqueness and phone→account mapping come free from
  Firebase Auth (~6¢/SMS) — no provider account, no `phoneE164` index, no
  custom verification flow, no SMS rate-limit bookkeeping.
- Sign-up no longer requires leaving the checkout (`/login` round-trip
  eliminated); the e2e-verified flow signs up in a dialog and lands
  identified on the same page.

**Cons:**
- Firebase phone auth SMS text/sender are Google-templated — no "OWW"
  sender ID, no German copy control.
- The e-mail path (custom `loginCodes`) and the SMS path (Firebase phone
  auth) verify differently behind one input field; the fork lives in
  `checkin-signin.tsx` and must stay behind its small controller surface.
- reCAPTCHA becomes a runtime dependency of phone sign-in (needs a check
  inside the Electron kiosk shell).
- `checkPhoneAccountExists` reveals whether a number is registered, bounded
  only by the origin allow-list and reCAPTCHA friction — unlike the e-mail
  path, whose next step carries the server-side 24h per-identifier caps
  (issue #152). Accepted at current scale (mirrors the deliberate Galaxus
  posture of the e-mail check); the SMS region policy and Firebase's own
  per-number throttling bound the abuse cost. Revisit with per-IP quotas if
  enumeration or SMS spend ever shows up in the logs.
- The QR code ("scan to continue on your phone") in the kiosk NFC affordance
  was dropped with the redesign — own-device checkout is now reached via the
  printed price-list QR or the URL note in the footer.

**Tradeoffs:**
- *Custom SMS provider (Twilio et al.)* was rejected: full message/sender
  control wasn't worth owning delivery, verification, uniqueness and
  rate limiting ourselves.
- *One persistent session everywhere* (dropping ADR-0022's ephemeral kiosk
  session) was rejected: shared-terminal sessions must not outlive the
  visitor.
- *Reusing `/login` via redirect* (status quo) was rejected: the full-page
  round-trip is exactly the discoverability problem the redesign removes.
