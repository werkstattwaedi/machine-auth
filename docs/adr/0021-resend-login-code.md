# ADR-0021: Resend-based email code + magic link login

**Status:** Accepted

**Date:** 2026-04-24

## Context

The web apps originally authenticated users via Firebase Authentication's built-in **email-link provider** (`sendSignInLinkToEmail` / `signInWithEmailLink`). That worked, but came with real problems:

- **Unbrandable email.** Firebase sends from `noreply@<project>.firebaseapp.com` with a generic template. The message looked unprofessional and got filtered into spam for several members.
- **No code-entry option.** Magic links work fine on desktop with the mailbox open in another tab, but fall apart on shared or kiosk devices. Many members read email on their phone while the browser session lives on a different device — the link then opens in the wrong browser and drops state. A 6-digit code that can be typed would fix this.
- **Deliverability is Firebase's to manage, not ours.** We already run Resend for invoice emails (ADR-0019), so we had a branded, well-warmed sender sitting idle for this use case.

The user-facing flow we wanted:
1. Enter email.
2. Receive an email with a 6-digit code **and** a magic link.
3. Either type the code (primary path, especially on mobile) or click the link (one-click path).
4. Session is established just like before — role-based redirects, admin custom claims, profile-completion gating, and Google-account linking all keep working unchanged.

## Decision

Replace Firebase's email-link provider with our own **one-time credential** flow backed by three callable Cloud Functions and a new `loginCodes/{id}` Firestore collection.

**Architecture:**

- `requestLoginCode(email)` — generates a 6-digit code and a random 32-byte doc ID (which doubles as the magic-link token). Stores only `sha256(code | docId)`, not plaintext. Sends the email via Resend using a template with `{CODE, MAGIC_LINK, EXPIRES_MINUTES}` variables. Rate-limited to one request per email per 60 s; prior unconsumed codes for the same email are invalidated so only the latest is usable.
- `verifyLoginCode({ email, code })` — looks up the newest unconsumed doc for that email, enforces a 5-attempt cap (6th attempt burns the doc), constant-time-compares the hash, and on success mints a Firebase custom token via `getAuth().createCustomToken(uid)`. The web client swaps it for a session via `signInWithCustomToken`.
- `verifyMagicLink({ token })` — direct doc lookup by ID (the magic-link token); same consume + mint pattern.

Both verify functions share a `mintSessionToken(email, method)` helper that resolves the Auth user (creating one if absent, mirroring Firebase's legacy email-link behavior) before minting the custom token.

**Security properties:**
- 10^6 entropy × 5 min expiry × 5-attempt cap → probability of a random guess succeeding is 5 / 10^6 within the window.
- `sha256(code | docId)` binds each code to its doc, so a leaked code from one request can't be replayed against another.
- Constant-time compare via `crypto.timingSafeEqual` prevents timing side-channels on the 64-char hash.
- Origin allowlist (`LOGIN_ALLOWED_ORIGINS` param, exact-match) prevents attacker-hosted sites from requesting magic links that point at themselves. Localhost is only honored when `FUNCTIONS_EMULATOR === "true"`.
- Firestore rules deny all client access to `loginCodes`; only server code reads or writes.
- Plaintext codes never persist in production. In the emulator only, a `debugCode` field is added to the doc so Playwright can read it for E2E tests — guarded by `isEmulator()`, which checks the `FUNCTIONS_EMULATOR` env var set by Firebase's emulator runtime.
- Firestore TTL policy on `expiresAt` auto-deletes old docs; read-path also filters by expiry (TTL can lag up to 24 h).

**Why not retry on failures:** unlike invoice emails (ADR-0019), there's no retry worker — if Resend fails to send a login email, the user just requests another code. 5 minutes expiry + 60 s rate limit make the blast radius small.

## Consequences

**Pros:**
- Branded email from our own domain, reusing the same Resend infrastructure as invoices.
- Code-entry works on phones where the email is on one device and the browser on another.
- Magic link still available for desktop users who want the one-click path.
- Full control over the email template and wording.
- Same custom-token → `signInWithCustomToken` pattern already used by NFC tag checkout (`functions/src/checkout/verify_tag.ts`), so the auth state changes are well-understood.

**Cons:**
- We now own this code path. If it breaks, no Firebase-side fallback.
- Needs a Resend template (`RESEND_LOGIN_TEMPLATE_ID`) and a production origin allowlist (`LOGIN_ALLOWED_ORIGINS`) set per environment — documented in `docs/config.md` and the deployment checklist. A missing origin allowlist causes 100% failure in production (intentional — fail closed).
- Each login costs ~3 Firestore ops (1 write for request, 1 read + 1 write for verify). At current scale this stays well inside the 100 K/month budget, but something to watch if user counts grow 100×.
- Attacker who knows a victim's email can burn their 5 attempts per minute — a narrow DoS on that user's ability to log in. Acceptable for a private makerspace; worth noting.

**Tradeoffs:**

- **Rejected: staying on Firebase email-link and just customizing the email.** The Firebase Console only lets us change template text, not the sender domain — and deliverability is the real problem. Not enough lever for the effort.
- **Rejected: SendGrid / AWS SES.** Resend is already in the stack and has a warmed sender. Adding a second provider would be pure cost.
- **Rejected: TOTP / passkeys / WebAuthn.** Higher bar for members who are not technical. Worth revisiting once the user base is larger.
- **Rejected: storing plaintext codes (even with tight expiry).** Cheap to hash, and if the Firestore data ever leaks (backup misconfig, rogue admin) hashed codes don't matter by the time anyone sees the dump.
- **Rejected: IP-based rate limiting or CAPTCHAs.** Not justified at our traffic. Can be added later if abuse shows up.
- **Rejected: retry worker for failed emails.** Login codes are cheap to re-request; added complexity for no user win.
