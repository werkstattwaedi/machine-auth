# ADR-0022: Kiosk badge sign-in — synthetic-UID session, not the user's session

**Status:** Accepted

**Date:** 2026-04-26

## Context

The kiosk runs an Electron app on a public Windows machine. A USB NFC reader detects an NTAG 424 DNA tag with a SUN/SDM URL, the renderer extracts `picc` + `cmac` query params, and the web app calls `verifyTagCheckout` (Cloud Functions) to identify the user and obtain a Firebase Auth session for downstream Firestore writes.

The first iteration of this flow had a fundamental defect: `verifyTagCheckout` minted a custom token via `createCustomToken(userDocId, { tagCheckout: true })` — i.e., the kiosk session shared the **same Firebase Auth UID** as the real user. Three things made this a hard "no":

1. **Persistent custom claims merge in.** Firebase merges custom claims set via `setCustomUserClaims` (e.g., the `admin: true` claim that `syncCustomClaims` writes when a user has `roles: ["admin"]`) with the developer claims passed to `createCustomToken`. The resulting ID token always carried the user's persistent claims. **An admin tapping their badge at the kiosk inherited a full admin session.**
2. **Firestore rules see the same principal.** Every `request.auth.uid == userDocId` and `isOwner()` predicate accepted the kiosk session. The `tagCheckout: true` developer claim was set but not consulted by any rule, callable, or client guard — purely informational.
3. **Browser persistence is sticky.** Firebase Auth defaults to `browserLocalPersistence` (IndexedDB). A closed kiosk tab/window restored the previous user's session on next visit. The 30-day refresh-token TTL meant a successful tap gave 30 days of seat-of-the-kiosk access.

Combined with two adjacent defects — the SDM read-counter was decrypted but never persisted, so a captured `?picc=…&cmac=…` URL replayed forever; and the public `verifyTagCheckout` HTTP endpoint had no origin check — a single captured URL was a permanent password. See `docs/Security Analysis.md` (untracked, in the launch-prep folder) for the full threat model.

We needed a session model that:
- lets the kiosk read the user's profile fields for form pre-fill, write a checkout, write items, retrieve the QR-bill — and **nothing else**;
- cannot inherit any of the user's persistent custom claims;
- is forgotten when the tab/window closes;
- treats a captured URL as a one-shot, not a password.

## Decision

The kiosk badge tap creates a **separate Firebase Auth principal** with a **synthetic UID** that names the real user only via a custom claim. Five layers, each independent:

### 1. Synthetic UID with `actsAs` claim

`functions/src/checkout/verify_tag.ts` mints the custom token as:

```ts
const sessionUid = `tag:${realUserId}:${crypto.randomBytes(12).toString("base64url")}`
const customToken = await getAuth().createCustomToken(sessionUid, {
  tagCheckout: true,
  actsAs: realUserId,
  kioskId: "kiosk-1",
})
```

`sessionUid` is a fresh value per tap. Because `setCustomUserClaims` is keyed on Auth UID, no persistent claims have ever been set for `sessionUid`, so Firebase has nothing to merge in. The `admin` claim that an admin user carries on their real Auth UID is structurally absent from the synthetic principal. This is the load-bearing defense: the rest of the layers harden it but the impossibility of admin-claim leakage comes from the UID being different.

The `actsAs` claim names the user the session is authorized to operate on. Every Firestore rule and Cloud Functions callable that previously compared `request.auth.uid` against a `userId` doc reference now uses an `effectiveUid` helper that returns `actsAs` when present, falling back to `request.auth.uid`:

```ts
// Firestore rules
function actsAs() {
  return isSignedIn() ? request.auth.token.get('actsAs', '') : ''
}
function isCheckoutPrincipalFor(userRef) {
  return isSignedIn() && (
    userRef == /databases/$(database)/documents/users/$(request.auth.uid) ||
    (actsAs() != '' && userRef == /databases/$(database)/documents/users/$(actsAs()))
  )
}

// Cloud Functions callables
function effectiveUid(request: CallableRequest<unknown>): string | null {
  const claims = request.auth?.token as { actsAs?: unknown }
  if (typeof claims?.actsAs === "string" && claims.actsAs.length > 0) return claims.actsAs
  return request.auth?.uid ?? null
}
```

The web client's `useTokenAuth` is unchanged in shape — it receives `customToken` from `verifyTagCheckout` and calls `signInWithCustomToken`. The synthetic UID is opaque to the client; the response payload still carries the real `userId` for form pre-fill.

### 2. SDM counter monotonicity (replay defense)

NTAG 424 DNA SDM messages include a 24-bit read counter (little-endian on the wire) that the tag increments on each tap. We persist it on the `tokens/{tokenId}` document and reject any incoming counter that does not strictly exceed the last observed value:

```ts
await db.runTransaction(async (tx) => {
  const snap = await tx.get(tokenRef)
  const lastCounter = (snap.data()?.lastSdmCounter as number | undefined) ?? -1
  if (incomingCounter <= lastCounter) {
    throw new Error("SDM replay detected: counter not advancing")
  }
  tx.update(tokenRef, { lastSdmCounter: incomingCounter })
})
```

The transaction serializes concurrent calls with the same picc, so two parallel requests cannot both succeed with the same counter. The `?? -1` sentinel makes the very first observation establish the baseline (real counters start at 0). A captured URL works exactly once.

### 3. Per-kiosk Bearer on `verifyTagCheckout`

The endpoint is registered with a per-route middleware that requires `Authorization: Bearer ${KIOSK_BEARER_KEY}` in production (emulator bypass via `FUNCTIONS_EMULATOR === "true"`). The Electron app reads the secret from env and exposes it to the renderer via `contextBridge` IPC; the web app's `useTokenAuth` reads it via `window.kiosk.bearer()` and sets the header.

**This is intentionally not real attestation.** Anyone with local admin on the kiosk Windows box can extract the secret. Its actual value:
- **Audit:** every accepted call is logged with `kioskId`.
- **Revocation:** rotate the secret if leaked.
- **Default rejection of phone taps:** a phone-opened SDM URL has no Bearer; the request 401s. Phones used to mint sessions; now they can't.

For real kiosk attestation we'd need TPM-anchored mTLS, a YubiKey/FIDO2 hardware key, or routing the call through the gateway (which already holds `GATEWAY_API_KEY` and lives on a more controlled machine). The plan tracks this as Phase F, deferred. The structural defense in §1 means a leaked Bearer doesn't grant anything more than a captured URL would — a narrow checkout-only session.

### 4. Volatile session storage

Two reinforcing mechanisms:

- **Web side:** `useTokenAuth` calls `setPersistence(auth, inMemoryPersistence)` before `signInWithCustomToken`. The Firebase Auth state lives in memory only — a closed tab is a closed session.
- **Electron side:** the `<webview>` uses a dedicated `partition="persist:kiosk:volatile"`. The main process calls `session.fromPartition(...).clearStorageData()` on app start, on the "Neuer Checkout" button, and via IPC from the web app's inactivity (5 min) and post-payment (30 s) auto-reset. A force-killed kiosk process loses nothing on restart because the next app start wipes the partition before the webview attaches.

Either layer alone would be insufficient (in-memory persistence resets only on explicit signOut; the Electron wipe handles the cases where the web app didn't get a chance to sign out cleanly).

### 5. Route gating

The web app's auth context resolves `sessionKind: "real" | "tag" | "anonymous" | null` from the ID-token claims (`tagCheckout === true`, `typeof actsAs === "string"`, or — as a network-free fail-safe — `firebaseUser.uid.startsWith("tag:")`). The checkout app's `_authenticated` and `_authonly` route guards refuse `sessionKind === "tag"` and bounce to `/`. The admin app lives on a different origin so its IndexedDB cannot see the kiosk's session at all.

The kiosk session can therefore reach: the kiosk root (`/`), the checkout wizard nested inside it, and the payment screen. Nothing else. The `/profile`, `/usage`, `/visit`, `/complete-profile`, `/link-account` routes return null and redirect.

### 6. Server-side bill recompute

`closeCheckoutAndGetPayment` ignores the client-supplied `summary.totalPrice` and recomputes from items + entry-fee config + persons. The first cut trusted `persons[].userType` as the input to the entry-fee calculation, which let an adult member post `userType: "kind"` and pay the child rate. An additional layer cross-checks `persons[0].userType` against the user's stored profile via `enforcePrimaryUserType` and silently overrides if it diverges. Additional persons (`persons[1..]`) are guests with no canonical record and remain trusted; the primary user vouches for them. Truly-anonymous sessions (no `userIdRef`) skip the cross-check because there is no record to compare.

## Consequences

**Pros:**
- The badge tap is no longer a password equivalent. A leaked `?picc=…&cmac=…` URL works exactly once (counter), and only when posted with a valid Bearer (kiosk) — and even then yields a session that cannot reach the member area or admin tools.
- Admin users can tap their badge at the kiosk without escalating to admin in that session. The synthetic UID makes admin-claim leakage **structurally impossible**, not policy-blocked.
- The kiosk session's authority is concrete and minimal: read the user's profile fields for pre-fill, read/write that user's open checkout and items, retrieve their invoice QR. Every other path 401s or redirects.
- The mechanism is small and inspectable: ~150 lines of `verify_tag.ts`, a few `actsAs` references in rules + callables, route guards, and the Electron wipe. No special crypto, no third-party services, no schema migration beyond `tokens/{id}.lastSdmCounter`.
- The same `effectiveUid` / `actsAs` plumbing extends to other future "act on behalf of" use cases (e.g., admin impersonation for support).

**Cons:**
- Phone taps now produce a `tap your tag at the kiosk` message instead of a working session. This is the design intent (the user explicitly chose "Kiosk-only"), but it removes a previously-supported UX. Anyone relying on the phone-tap shortcut needs to be told.
- The `inMemoryPersistence` switch is sticky on the Auth singleton. A phone user who accidentally lands on a tag-tap URL and authenticates flips persistence for that browser tab; subsequent email logins won't survive a tab close. Annoyance, not a security hole, and the kiosk path is unaffected because Electron wipes the partition.
- Two operational steps before deploy: `firebase functions:secrets:set KIOSK_BEARER_KEY`, and enable Firebase Anonymous Auth in the Console (the no-account checkout path now signs in anonymously so rules can require `isAnonymousAuth()` instead of an `if true` create branch). Documented in the deployment checklist.
- Existing `tokens/{id}` documents have no `lastSdmCounter` field. The `?? -1` sentinel handles missing fields gracefully on first observation, so no migration is required, but it means the very first counter value seen post-deploy is accepted regardless of what it is. Acceptable: the worst case is one final replay opportunity per tag.
- The kiosk Bearer secret on the Windows machine is recoverable by any technically-inclined attacker. We accept this and rely on the synthetic UID as the structural defense; see the explicit non-goal below.

**Explicit non-goals:**
- **Real kiosk attestation.** The Bearer is audit/revocation, not attestation. If a higher-trust environment requires hardware-anchored kiosk identity, route the call through the gateway (Phase F in the plan) or add TPM mTLS / FIDO2.
- **Validating guest `userType` in multi-person checkouts.** Only `persons[0]` is cross-checked. Additional persons are trusted as the primary user vouches for them. A registered adult bringing two adult guests cannot fraudulently classify them as children — but this is by social trust at the workshop, not enforced.
- **Validating `userType` on truly-anonymous checkouts.** No user record exists. Whoever's at the kiosk picks; the cashier (or future operator review) is the backstop.

**Tradeoffs:**

- **Rejected: keeping `uid = userDocId` and adding rule checks for `tagCheckout`.** Would have left `admin: true` claims merged in regardless. Even if every rule and callable consulted the `tagCheckout` claim correctly, any future rule that forgot to (or any new callable) would re-introduce the leak. The synthetic UID makes the design fail-safe rather than fail-open.
- **Rejected: minting an admin-stripped custom token.** Firebase doesn't support per-session claim filtering for `setCustomUserClaims` — the persistent claims always merge. The synthetic UID is the only way to opt out without going through a separate Auth project.
- **Rejected: requiring App Check on `verifyTagCheckout` instead of a Bearer.** App Check needs reCAPTCHA Enterprise (web) or a custom provider (Electron). For a single kiosk, the Bearer mirrors the existing Particle/gateway middleware pattern with one new env var; App Check would require a custom provider implementation and a separate attestation backend. Worth revisiting alongside Phase F.
- **Rejected: signing out on every checkout completion as the only volatility mechanism.** Sign-out is async and any code path that misses it leaves a session in IndexedDB. The Electron `clearStorageData` wipe is unconditional.
- **Rejected: deferring the SDM counter check.** It's the cheapest, highest-impact fix in the chain; no operational reason to ship without it.
