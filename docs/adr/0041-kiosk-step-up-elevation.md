# ADR-0041: Kiosk step-up — OTP-elevated `actsAs` sessions reach the member area

**Status:** Accepted (amends [ADR-0022](0022-kiosk-badge-session-model.md) §5 route gating and [ADR-0031](0031-embedded-checkin-signin-and-sms-codes.md))

**Date:** 2026-09-13

## Context

A kiosk sign-in (badge tap, e-mail code, SMS code) mints the synthetic-uid
`actsAs` session of ADR-0022. That session is deliberately checkout-only:
`/account/*` bounces `sessionKind === "tag"`, the `users/{id}` update rule
requires `request.auth.uid == userId`, and every membership callable rejects
`actsAs` (`callerUserRef` in `functions/src/membership/shared.ts`).

Two problems in practice:

- **Memberships cannot be bought at the kiosk.** `purchaseMembership` refuses
  `actsAs`; the kiosk welcome onboarding and the "Deine Angaben" view tell
  people to do it "in deinem Konto" — on their own device. That is exactly the
  moment they are standing at the workshop wanting to become a member.
- **The checkout is hard to explain** because the account side of the story
  (profile, family roster, bills) is invisible from the kiosk.

The reason the lock-out exists is a single attack: a badge alone must not be a
key to the account. Possession of an NTAG424 (lost, borrowed, lifted from a
jacket) currently yields a checkout-only session and nothing else. Any
loosening must preserve that: **a badge tap on its own still gets nothing but
the checkout.**

The existing code already proves possession of a second factor at the kiosk in
two of the three mint paths — the e-mail login code (`verifyLoginCodeKiosk`)
and the SMS code (`exchangeKioskSession`). Only the badge tap does not.

## Decision

**Replace "tag sessions can never reach the member area" with "tag sessions
reach the member area only while *elevated*, and elevation requires a fresh
OTP bound server-side to the account's own contact address."** The synthetic
uid, in-memory persistence, Electron partition wipe, and kiosk bearer gate of
ADR-0022 are unchanged; elevation is one additional claim.

### 1. One new claim: `elevatedUntil`

`mintKioskSessionToken` gains an optional `elevatedUntil: number` (epoch ms)
claim. The claim is the only thing that distinguishes an elevated session; the
uid stays `tag:<userId>:<nonce>`, so persistent custom claims (`admin`) remain
structurally absent (ADR-0022 §1 is untouched).

| Mint path | `method` | Elevated at mint? |
|---|---|---|
| `verifyTagCheckout` (badge tap) | `tag` | **No** — the badge is the thing we do not trust alone |
| `verifyLoginCodeKiosk` (e-mail code) | `emailCode` | Yes — the OTP was just entered |
| `exchangeKioskSession` (SMS code) | `smsCode` | Yes — the OTP was just entered |
| `signupKiosk` (new account via e-mail code) | `signup` | Yes |
| **new** `verifyKioskElevation` (step-up of a `tag` session) | unchanged | Yes — re-mints the *same* session uid with `elevatedUntil` |

The TTL is fixed, server-side, and short: `KIOSK_ELEVATION_TTL_MS`
(`defineString`, default `900000` = 15 min; wire through
`scripts/generate-env.ts` or the emulator hangs — CLAUDE.md gotcha). There is
no sliding renewal: extending elevation means entering a new code.

### 2. Step-up: channel picker, then e-mail code or SMS code

Both OTP channels that already exist for kiosk sign-in (ADR-0031, SMS live
since `VITE_SMS_LOGIN_ENABLED=true` in every environment) are offered for the
step-up. The dialog opens with a small interstitial:

> Zur Sicherheit bestätigen wir kurz, dass du das bist. Code senden an:
> **[ +41 79 ••• •• 28 ]**  **[ mi•••@gm•••.com ]**

SMS is listed first when the account has an Auth-linked phone number (the
verified self-service state from `/account/profile`); with e-mail only, the
interstitial collapses to a single *Code senden* button. Then the existing
`CodeEntryDialog`.

- `getKioskElevationOptions({ bearer })` — `requireActsAs(request)`; returns
  `{ email: { masked }, sms: { masked, phoneNumber } | null }` where
  `phoneNumber` is the E.164 number from `getAuth().getUser(actsAs)` (the
  *linked* number, not the free-text `users.phone`). The full number is
  needed because Firebase phone auth is client-driven; disclosing it to the
  `actsAs` session is nothing new — that session can already read the whole
  `users/{actsAs}` doc for pre-fill. Only the masked forms are rendered.
- **E-mail:** `requestKioskElevation({ bearer })` calls the existing
  `handleRequestLoginCode` with the **stored** e-mail (the client never
  supplies an address, so a badge holder cannot redirect the code; every
  login-code limit applies unchanged — 60 s throttle, 20 codes / 24 h,
  30 attempts / 24 h, 5 attempts / doc, 5 min expiry). Then
  `verifyKioskElevation({ code, bearer })` — `requireActsAs`, e-mail resolved
  from the user doc again, `consumeLoginCode`, and
  `createCustomToken(request.auth.uid, { ...existing claims, elevatedUntil })`.
  Re-using `request.auth.uid` keeps `modifiedBy`, the open checkout and the
  module-level `kioskTokenUser` store valid; the client calls
  `establishKioskSession` and the wizard does not notice.
- **SMS:** the same client path `checkin-signin.tsx` already runs for kiosk
  SMS sign-in — `signInWithPhoneNumber(auth, phoneNumber, recaptcha)`,
  `confirm(code)` (which signs the kiosk in as the real uid for a moment),
  then the existing `exchangeKioskSession`, which now mints with
  `elevatedUntil`, and `establishKioskSession` replaces the session; on any
  failure the real phone session is signed out, as today. Identity binding is
  inherent: the uid that confirmed the SMS is the uid the new session acts
  as. To guarantee elevation never *changes* who the session is, the call
  gains an optional `expectedUserId` (the prior `actsAs`) and rejects with
  `failed-precondition` on mismatch. The session uid gets a new nonce on this
  path (the old session is gone by then), which nothing depends on.
  Delivery, throttling and cost (~6¢/SMS) stay with Firebase; a badge holder
  can trigger SMS sends to the victim's phone, bounded by reCAPTCHA and
  Firebase's per-number throttling — the same exposure `/checkin` has today
  for anyone typing a number.

### 3. Authorization: three enforcement points, all reading the claim

- **Firestore rules** — new helper
  `isElevatedActsAs() = actsAs() != '' && request.auth.token.get('elevatedUntil', 0) > request.time.toMillis()`.
  `users/{userId}` `update` gains the branch
  `isElevatedActsAs() && actsAs() == userId && roles/permissions pinned && email pinned && isValidUserProfile(...)`.
  `email` is pinned explicitly: `users.email` is the login-code lookup key, so
  an e-mail change from an elevated kiosk session would be an account takeover.
  Reads need no change — `users`, `checkouts`, `bills`, `usage_machine`,
  `memberships` already carry `actsAs()` read branches (issue #422 et al.).
- **Callables** — `requireElevatedActsAs(request)` next to `requireActsAs` in
  `kiosk_session.ts`. `membership/shared.ts callerUserRef` accepts an elevated
  `actsAs` and returns `users/{actsAs}`; expired or un-elevated `actsAs` keeps
  today's `permission-denied`. `accept_invite`/`list_my_invites` read
  `token.email`, which a synthetic token lacks — they resolve the e-mail from
  the user doc when `actsAs` is set (shared helper, not per-callable patches).
  Admin membership callables keep checking `token.admin` and therefore stay
  unreachable (structural, not policy).
- **Client** — `useAuth()` exposes `kioskElevatedUntil: number | null`; a
  timer flips it to `null` at expiry. `AuthenticatedLayout`'s member gate and
  `_authonly` allow `sessionKind === "tag"` iff elevated, and bounce to
  `/checkin?kiosk` (not `/`) otherwise — including mid-page when the timer
  fires. For elevated tag sessions the auth context subscribes to
  `users/{actsAs}` so the account pages' `userDoc` works, but `isAdmin` is
  forced `false` and the admin-claim `getIdToken(true)` refresh is skipped.

### 4. Kiosk UX

- **Entry points** in the wizard: a "Konto verwalten" action in the signed-in
  "Deine Angaben" block and in the kiosk welcome onboarding's closing step
  (replacing the "auf deinem eigenen Gerät" copy), plus "Mitglied werden" for
  non-members, and the header account menu (`AccountMenu`: Profil /
  Nutzungsverlauf / Mitgliedschaft; its "Abmelden" is the start-over wipe and
  never steps up). If already elevated → navigate; otherwise
  `KioskElevationDialog` (§2): the channel interstitial, then the existing
  `CodeEntryDialog`.
- **Account area in kiosk mode** (detected via `useBridge().available` — the
  `?kiosk` search param only exists on the wizard route):
  "Abmelden" runs `runStartOver` (signOut + partition wipe + reload to
  `/checkin?kiosk`); Google-link, e-mail, and phone-verification affordances
  are hidden (linking needs a real uid anyway); a header chip shows the
  remaining elevation time; "Zurück zum Checkout" returns to `/checkin?kiosk`.
- **Gotcha:** `_wizard.tsx` signs out on mount whenever `isKiosk && !picc && !cmac`
  (the "Neuer Checkout" fallback). Returning from `/account` would kill the
  session. `startOver` already signs out and wipes, so this effect is retired
  (or guarded on "no current tag session") in the same PR.

### 5. Walk-away: what changes and what bounds it

Today a visitor who signs in and walks away leaves a checkout-only session
for up to 5 min idle (+30 s dialog), and only if there is preservable state.
Elevation adds profile PII, bills/usage history, membership purchase/renewal,
and family invites to what the next person could touch. Bounds:

1. **Server-enforced TTL** (15 min, rules + callables + client), no renewal
   without a new code. This holds even if the client watcher never fires.
2. **Account-area idle watcher.** `KioskInactivityWatcher` lives inside the
   wizard and only arms with preservable state. A root-level kiosk watcher
   covers `/account/*` whenever the session is elevated, with a shorter idle
   (2 min → "Bist du noch da?" → 30 s → `startOver`).
3. **Existing wipes** stay: payment completion, "Neuer Checkout", badge
   switch, app start.
4. **No takeover path.** E-mail is pinned by the rule, phone linking is
   impossible under a synthetic uid, admin claims are absent. The worst case
   inside the window is a nuisance purchase on the victim's open checkout
   (same class as material purchases today) or a family invite to a stranger —
   visible on the membership page and revocable.

The tag-only attacker — the vector this ADR is about — gains nothing: a badge
tap still yields the checkout-only session it does today.

## Consequences

**Pros:**
- Membership purchase and account management work at the kiosk; the
  onboarding no longer sends people away to their own device.
- The security posture is *stronger* for code sign-ins (unchanged) and
  *unchanged* for badge taps; the badge alone never reaches the account.
- Small mechanism: one claim, two callables, one rules helper + one rule
  branch, one `callerUserRef` change, guard tweaks. No schema migration.
- The same `elevatedUntil` gate can later protect other sensitive kiosk
  actions (e.g. rolling a bill to monthly) without new plumbing.

**Cons:**
- A second OTP for badge-tap users who want the account area (by design).
  Code sign-ins are elevated at mint so they are not asked twice.
- The account pages gain a "kiosk mode" (hidden affordances, sign-out =
  start-over, idle watcher) — a second rendering context to keep green in the
  e2e/screenshot suites.
- `accept_invite`/`list_my_invites` lose the "e-mail comes from the verified
  token" shortcut for `actsAs` callers and read the user doc instead.
- The SMS branch briefly signs the kiosk in as the real uid between
  `confirm()` and the exchange — an existing, accepted window from ADR-0031,
  now reachable from one more place.
- New env param must be wired through `generate-env.ts` and the ops repo
  before deploy.

**Tradeoffs:**
- *Mint a real-uid session after the OTP* (the "just log them in" option):
  rejected — persistent claims merge in (an admin's badge + code = admin
  session on a public PC), and it re-opens the sticky-persistence problem
  ADR-0022 closed.
- *Kiosk-only account UI via callables, never opening `/account/*`*:
  rejected — duplicates the membership/profile UI; the callable gating is
  needed anyway and is the part we keep.
- *Elevate for the life of the session (no TTL)*: rejected — the walk-away
  window would depend entirely on the client watcher.
- *Always require the step-up, even after a code sign-in*: rejected as pure
  friction — the code was entered seconds ago. Open for discussion.

## Implementation map

- Claim + helpers: `functions/src/checkout/kiosk_session.ts`
  (`mintKioskSessionToken({ elevated, sessionUid })`, `requireElevatedActsAs`,
  `isElevatedNow`, `KIOSK_ELEVATION_TTL_MS`).
- Step-up callables: `functions/src/checkout/kiosk_elevation.ts`
  (`getKioskElevationOptions`, `requestKioskElevation`,
  `verifyKioskElevation`); SMS branch via `exchange_kiosk_session.ts`
  (`expectedUserId`).
- Membership caller resolution: `functions/src/membership/shared.ts`
  (`callerUserRef`, `callerEmail`).
- Rules: `isElevatedActsAs()`, the `users` update branch (e-mail pinned) and
  the elevated-owner invites read in `firestore/firestore.rules`.
- Web: `useAuth().kioskElevatedUntil` / `isKioskElevated` (`auth.tsx`, now on
  `onIdTokenChanged`), guards in `authenticated-layout.tsx` / `_authonly.tsx`,
  `KioskElevationProvider` + `useKioskElevation` (`kiosk-elevation-dialog.tsx`),
  `useKioskSms`, `KioskAccountActions`, `KioskAccountIdleWatcher`,
  shared `kiosk-idle-dialog.tsx`.

## Work breakdown (as shipped in one PR)

1. **Functions + rules** — claim, `requestKioskElevation`/`verifyKioskElevation`,
   `requireElevatedActsAs`, `isElevatedActsAs()` + `users` update branch,
   `callerUserRef` + e-mail resolution for `actsAs`, `elevatedUntil` on the
   three code mint paths. Tests: functions integration (step-up happy path,
   wrong/expired code, non-actsAs caller, bearer missing, purchase with
   elevated vs. un-elevated vs. expired token); cross-user rules matrix
   (elevated-as-alice updates alice, cannot touch bob, cannot change
   e-mail/roles, expired claim denied).
2. **Web auth + guards** — `kioskElevatedUntil` in `useAuth`, guard changes,
   `AuthenticatedLayout` kiosk mode, root kiosk idle watcher, retire the
   `_wizard` mount sign-out. Unit tests on `authenticated-layout.test.tsx`
   (elevated tag passes, expired bounces to `/checkin?kiosk`).
3. **Wizard entry points + dialog + e2e** — `KioskElevationDialog`, "Konto
   verwalten"/"Mitglied werden" actions, onboarding copy. E2E: tap → Konto →
   code → `/account/membership` → purchase → item appears in the kiosk cart;
   screenshot baselines via the `update_snapshots` workflow.
4. **SMS branch** — `expectedUserId` on `exchangeKioskSession` and the
   `elevatedUntil` claim land in step 1; the dialog's SMS branch reuses the
   kiosk phone path from `checkin-signin.tsx` (extract `verifySmsCode` into a
   shared hook rather than copying it). E2E mirrors `sms-login.spec.ts`
   (link the phone via the Auth emulator, `waitForSmsCode`).
5. **Docs/ops** — amend ADR-0022 §5 status line, deployment checklist entry
   for `KIOSK_ELEVATION_TTL_MS`, ops-repo config.

## Decisions taken (2026-09-13)

- Code sign-ins (e-mail, SMS, kiosk sign-up) are elevated at mint; only a
  badge tap steps up.
- TTL 15 min; account-area idle 2 min.
- Full session: everything the own-device login can do, including
  accepting and rejecting incoming family invites (`callerEmail` resolves
  the address from the user doc for synthetic tokens).
