# ADR-0030: Self-service badge purchase at the checkout kiosk

**Status:** Accepted

**Date:** 2026-07-03

## Context

For the checkout + MaCo launch, members and visitors need NFC badges (NTAG424 DNA) without staff involvement. Pre-personalized badges — the five diversified AES keys programmed by the factory personalization app, but **no `tokens/{uid}` Firestore doc** — sit in a stack at the kiosk. A visitor should be able to tap one, have it added to their checkout, and walk away with a working badge.

Constraints that shaped the design:

- **Unassigned badges are invisible to the data model.** "Registered" and "assigned" were the same thing: a `tokens/{uid}` doc only ever existed with a `userId`. `verifyTagCheckout` threw `"Token not found"` for a genuine-but-unassigned badge, even though `decryptAndVerifyTag` proves authenticity from UID-diversified crypto alone.
- **Verify-exactly-once (issue #420).** Each physical tap yields one SDM counter value; a second verify of the same URL is rejected as a replay. Any mid-session "what badge is this?" pre-check must not consume the counter.
- **Tokens are admin-only** in Firestore rules, and kiosk sessions don't carry the user's `permissions` client-side — so eligibility, pricing, and association must all be server-side.
- **Pricing:** the first badge is free for active members and for anyone holding *any* permission (every granted permission implicitly requires a badge); every other badge costs the catalog price (5 CHF). No badge-count limit.

## Decision

### 1. Unregistered ≠ error: a discriminated verify response + a read-only probe

`verifyTagCheckout` returns a union: the existing registered/session payload (now with `registered: true`), or `{ registered: false, tokenId, badgeVoucher }` for an authentic badge with no `tokens` doc — no session, no counter transaction (there is no doc to store the counter on; see §2 for why that's safe).

A new kiosk-bearer-gated `probeTag` callable (`functions/src/checkout/probe_tag.ts`) is the mid-session pre-check: decrypt + CMAC-verify only, **no counter advance, no session mint** — the kiosk analog of the admin `resolveTag`. `BridgeNfcRouter` probes every tap that arrives while a preservable session is active, and only then decides: registered → the existing switch/discard confirmation; unregistered + identified → the purchase dialog (session untouched); unregistered + anonymous → a sign-in-first notice instead of the destructive discard dialog.

### 2. Signed badge voucher — proof of physical tap

`addBadgeToCheckout` never accepts a bare `tokenId`: that would let anyone remotely claim ("squat") a badge from the kiosk stack by enumerating UIDs. Instead the server returns a **signed voucher** (`functions/src/badge/voucher.ts`) from the unregistered verify/probe: HMAC-SHA256 over `tokenId.sdmCounter.expiresAt`, ~15 min TTL, key domain-separated from `DIVERSIFICATION_MASTER_KEY` (no new secret to provision).

The voucher carries the tap's SDM counter. At association the counter is stamped into the new token doc's `lastSdmCounter`, closing the window where a captured *pre-registration* tap URL could replay as a sign-in *after* registration (the `-1` sentinel would otherwise accept any counter on the first post-registration verify). A replayed unregistered-tap URL itself only re-opens a purchase offer — the purchase requires an authenticated session and association goes through the voucher.

### 3. Server-side purchase: `addBadgeToCheckout` (billingCall)

Mirrors `purchaseMembership`: resolves the badge SKU via `config/catalog-references.badge`, find-or-creates the caller's open checkout (`usageType: "materialbezug"`), and appends the line item in a transaction. The caller resolution (`effectiveCallerRef`) **accepts kiosk `actsAs` principals** — badge purchase happens at the kiosk, so the tag/email-code session is the expected caller; Firebase-anonymous and unauthenticated callers are rejected.

**Pricing is variant selection, not a computed override:** the badge SKU carries two `direct` variants — `standard` (5 CHF) and `gratis` (0 CHF) — and the server picks `gratis` iff the user is eligible (active membership OR any permission) AND owns zero active tokens AND has no badge already in the checkout. The price is always catalog data; the item's `variantId` self-documents why it was free; the invoice renders it honestly.

**Dedup/races**, inside the transaction: reject when `tokens/{tokenId}` already exists, when the same tokenId is already in this checkout, or when it is pending in another *open* checkout (collection-group query on `items.tokenId` — two kiosk sessions racing over one physical badge). `dryRun: true` runs every check and returns the quote without writing — the purchase dialog's price display, so eligibility logic exists exactly once.

The line item carries `tokenId` + `badgeSdmCounter`. These fields are **server-written only**: firestore.rules deny them on all client item creates/updates (a client-minted `tokenId` would associate an arbitrary badge at close). Deleting a badge item stays client-allowed — cart removal, nothing to unwind.

### 4. Association at checkout close, not payment ack

`onCheckoutClosedAssociateBadges` (`functions/src/badge/associate_on_close.ts`) fires on the open→closed edge (same shape as `create_bill.ts`) and creates `tokens/{tokenId}` with the checkout's `userId`, a `Badge (Selbstkauf <date>)` label, and the voucher's counter. Close — not bill-ack like membership activation — because the buyer physically walks away with the badge; it must work on the machines immediately even when they pay by invoice later.

Idempotency and safety: `tx.create` per token (a trigger retry no-ops), per-item try/catch (one conflicting badge never blocks the others or the close), and an existing doc owned by someone else is **never clobbered** — logged loudly for staff to resolve the refund manually. Close-time guards back the rules up: badge items on a null-userId checkout are rejected (`assertBadgeItemsBelongToOwner`), and `intern` (which zeroes material) cannot coexist with a *paid* badge (same loophole class as intern+membership, issue #284).

### 5. Kiosk UX: tap-driven and menu-visible

- Tap an unassigned badge during an identified session → "Badge kaufen?" dialog with the server quote.
- Tap it with no session → sign-in-first notice; the voucher is parked in a pending-badge store (module state + sessionStorage) and the offer resumes after sign-in **without a re-tap** (the email-code sign-in is SPA-internal, ADR-0022 amendment).
- The /visit step shows a "Badge" inline section (peer of the membership section) listing purchased badges with remove affordances, plus a CTA inviting identified kiosk visitors to tap a new badge.

## Consequences

**Pros:**
- Fully self-service distribution: no admin round-trip to hand out badges; the admin registration flow remains for special cases and replacements.
- The unassigned state stays "no doc" — no schema migration, no nullable-`userId` weakening of `TokenEntity`; `verifyTagCheckout`'s registered path, terminal auth, and admin flows are untouched.
- Squat-proof: claiming a badge requires holding it (voucher = signed proof of tap) *and* an authenticated session; association is transactional and never overwrites an existing owner.
- The eligibility/pricing rule lives in exactly one place (server, `dryRun` quote), and the price itself lives in exactly one place (catalog variants).

**Cons / accepted risks:**
- An invoice-paying buyer can walk away with an associated badge and never pay — same trust model as the rest of the invoice flow; the bill exists, follow-up is organizational.
- A parked voucher expires after 15 min; the recovery is a re-tap (clean German error).
- `probeTag` adds one server round-trip to mid-session taps (registered-badge switch included). Acceptable: the probe is a single doc read after crypto, and mid-session taps are the rare path.
- The unregistered verify branch has no replay defense until association. Bounded: a replay can only re-open a purchase offer, and the post-registration window is closed by seeding `lastSdmCounter` from the voucher.

**Explicit non-goals:**
- Badge purchase on the user's own phone (Web NFC): the kiosk is the only reader that meets the "badge stack next to the screen" reality; the flow works for own-device sessions in principle but is not surfaced.
- Refund/deactivation automation when association is skipped due to a conflict — staff resolves from the ops log.

**Tradeoffs:**
- **Rejected: representing unassigned badges as owner-less `tokens` docs.** Would have weakened the `TokenEntity.userId` invariant every consumer relies on, required a migration for personalization tooling, and made "unassigned" writable state instead of derived absence.
- **Rejected: association at bill-ack (membership pattern).** The badge is a physical object already in the buyer's pocket; a badge that doesn't open machines until payment confirmation is a support burden, not a safeguard.
- **Rejected: client-computed price display.** Kiosk sessions don't see `permissions`; extending the verify payload would leak permission data to a public terminal and duplicate the eligibility rule. The `dryRun` quote keeps one source of truth at the cost of one extra callable round-trip when the dialog opens.
