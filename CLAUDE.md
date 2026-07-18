# Machine Authentication System - AI Context Documentation

**Note:** This document provides AI-specific development context (patterns, commands, gotchas). For architectural decisions and requirements, see [`docs/`](docs/README.md).

## Project Overview

This is a comprehensive IoT machine authentication system featuring secure NFC-based access control, usage tracking, and cloud synchronization. The system uses NTAG424 DNA NFC tags for secure mutual authentication.

### System Components

| Component | Location | Description |
|-----------|----------|-------------|
| **MACO Firmware** | `maco_firmware/` | Pigweed-based firmware (Bazel build) |
| **Functions** | `functions/` | Firebase Cloud Functions (TypeScript) |
| **Web (Checkout)** | `web/apps/checkout/` | Public checkout app (React + Vite + shadcn/ui) |
| **Web (Admin)** | `web/apps/admin/` | Admin dashboard (React + Vite + shadcn/ui) |
| **Web (Shared)** | `web/modules/` | Shared Firebase, hooks, UI components |
| **Shared TS** | `shared/` | `@oww/shared` — SDK-agnostic types/helpers consumed by web, functions, and the Electron kiosk. See [ADR-0027](docs/adr/0027-shared-typescript-package.md). |
| **Checkout Kiosk** | `checkout-kiosk/` | Electron hardware bridge (NFC today; printer next per #313/#314) |
| **Gateway** | `maco_gateway/` | Python pw_rpc proxy (ASCON + Firebase) |

**Component-specific documentation:**
- [`maco_firmware/CLAUDE.md`](maco_firmware/CLAUDE.md) - Pigweed patterns, building, architecture
- [`third_party/particle/CLAUDE.md`](third_party/particle/CLAUDE.md) - Particle Pigweed backends

### Build Commands (MACO Firmware)

**For Claude (AI assistant) - always use `./pw`:**

```bash
./pw build host       # Build simulator (no IDE change)
./pw build p2         # Build P2 firmware (no IDE change)
./pw flash            # Flash to device
./pw build asan       # Address Sanitizer
./pw factory-flash    # Flash factory test firmware
./pw factory-console  # Factory test TUI (interactive checklist)
```

**For human developers:**
- `bazel build ...` → Updates IDE compile_commands to match target
- `./pw ...` → No IDE changes (use for flash, sanitizers)

See [`docs/adr/0009-local-build-flash-tooling.md`](docs/adr/0009-local-build-flash-tooling.md) for details.

### Documentation Structure

- **`docs/`**: Structured project documentation
  - `docs/config.md`: Complete configuration guide for new environments
  - `docs/compile.md`: Firmware build instructions
  - `docs/adr/`: Architecture Decision Records
  - `docs/requirements/`: Product requirements and specifications
  - `docs/ideas/`: Exploration, brainstorming, future work

**When to update docs:**
- Create an ADR when making significant architectural decisions
- Update `docs/ideas/backlog.md` when discovering future work
- Update component CLAUDE.md files for development patterns
- Don't over-document - focus on "why" for non-obvious decisions

### How It Works

1. User presents NTAG424 tag to NFC reader on machine terminal
2. Terminal authenticates tag using mutual authentication (3-pass AES-128)
3. Backend verifies user permissions and creates/returns session
4. Machine activates relay to enable equipment
5. Usage data tracked locally and synced to cloud
6. Sessions closed via UI, self-checkout (NFC tag tap on phone via SDM), timeout, or new tag

## Cloud Integration

### Firebase Operations Budget

Firestore Spark (free) plan: **50K reads / 20K writes / 20K deletes per day** ([pricing](https://firebase.google.com/docs/firestore/pricing)). Blaze overage is ~$0.06 per 100K extra reads, so an occasional spike costs cents, not dollars.

Posture: rely on the Firebase usage dashboard. If a single day breaches the quota, investigate the offending path and fix that one query — do not pre-emptively add caching layers.

Design decisions that already help keep ops down:
1. Terminal-side permission checking after session established
2. Local session caching
3. Batch usage uploads
4. Future: Session broadcasting between devices

**Login-code rate limits** (issue #152, `functions/src/auth/login-code/`): per-email caps of 20 code requests/24h and 30 cumulative verify attempts/24h, layered on top of the 60s per-email throttle and the per-doc 5-attempt cap. The 24h caps are tunable via `defineString` env params — `LOGIN_PER_EMAIL_WINDOW_MS` (default `86400000`), `LOGIN_MAX_CODES_PER_EMAIL` (default `20`), `LOGIN_MAX_ATTEMPTS_PER_EMAIL` (default `30`) — so values can be retuned from the operations repo without a code change. Don't loosen the defaults without re-evaluating the brute-force keyspace math (10^6 codes).

**Price-list QR codes** (issue #248, `functions/src/price_list/get_price_list_pdf_url.ts`): the QR printed on price-list PDFs encodes `https://${CHECKOUT_DOMAIN}/visit/add/list/<priceListId>`. `CHECKOUT_DOMAIN` is a `defineString` param sourced from `web.checkoutDomain` in the operations config — there is no production fallback, so an unset value throws `failed-precondition` instead of silently shipping `localhost:5173`. In emulator mode the empty value defaults to `localhost:5173`.

**Catalog import from Mario's pricelist xlsx** (admin `/materials/import`): Mario maintains one Excel workbook with a sheet per workshop (`Holz`/`Metall`/`Keramik`/`Textil`/`Glas`/`Stein`/`Schmuck`/`Makerspace`). The importer reads, by *header text* (not position): the injected `Code` (stable 4-digit identity, **never reused/renumbered**), `Kategorie`, `Unterkategorie`, `Einheit` (→ pricing model; incl. `L`→`sla`), plus Mario's curated `Etikett Name` / `Etikett Mass` (the printed label — stored verbatim as `labelName`/`labelMass`, and composed into the display `name`), his `Preis Einheit Verkauf`, and a `Varianten` column (comma-separated variant ids). `Etikett Kategorie` / `Etikett Preis` are ignored (category comes from the section-derived columns, price from `Preis Einheit Verkauf`). Pipeline: `previewCatalogImport`/`applyCatalogImport` (catalogCall) parse with **exceljs** (cached formula results), normalise+diff via `@oww/shared` `catalog-import.ts` (create/update/unchanged/retire by code; retirement scoped to imported workshops, never touches `type:"machine"` items), apply in batched writes. The bootstrap `scripts/augment-pricelist-bootstrap.py` (Python/openpyxl) re-derives `Kategorie`/`Unterkategorie` from the section headings + `Einheit` per section, injects `Code` (matched to the seed to keep codes stable, else next-in-band; written as numeric cells), normalises the Etikett labels, and generates two sheets Mario's file lacks — a `Makerspace` product sheet (one-time, from `makerspace.json`) and a global `Varianten` definition sheet — run it on Mario's latest file, then **share the produced `… – mit Codes.xlsx` back to Mario so the injected columns persist** (they only survive if he works from ours). Two gotchas: (1) a workbook whose formulas aren't evaluated (openpyxl output, or Glas's broken `#N/A` rows) has **no cached price** — the preview shows an "open in Excel and save" hint instead of per-row errors (Makerspace prices are literal, so exempt); (2) **variant definitions live in the workbook `Varianten` sheet** (`Variante`/`Bezeichnung`/`Faktor`/`Grundmodell`), *not* hardcoded. The importer expands each item's full `variants[]` at import time — base + one derived option per applicable id, priced `base × factor` **rounded to 0.05** (`expandVariants`/`roundTo5` in `@oww/shared`). Firestore stores the fully-priced `variants[]`; readers read it directly (no read-time resolution). An admin-set `member` override on the base is preserved + propagated to the cuts on re-import.

For onSnapshot accounting see [issue #147](https://github.com/werkstattwaedi/machine-auth/issues/147) — concurrent identical listeners share a single watch stream; the dominant cost is sequential remounts paying the initial fetch.

### Firebase Functions

All code in `functions/`

```bash
cd functions/
npm run build          # Build
npm run serve          # Local emulator
npm run test           # All tests
npm run deploy         # Deploy (wraps firebase deploy + bundles @oww/shared)
```

Deploy uses `scripts/deploy-functions.ts` to pack `@oww/shared` and rewrite
`functions/package.json` to a `file:` ref before invoking
`firebase deploy --only functions`. See [ADR-0027](docs/adr/0027-shared-typescript-package.md).

**Clean rebuild if stale:**
```bash
rm -rf lib/ && npm run build
```

### Firestore Schema

See `firestore/schema.jsonc` for complete structure.

**Key Collections:**
- `users/{userId}`: User profiles (doc ID == Firebase Auth UID; see `auth/create-user.ts`, `auth/set-custom-claims.ts` — holds for managed members too)
- `tokens/{tokenId}`: NFC tag registrations (top-level, tokenId = tag UID)
- `authentications/{authId}`: Tag authentication state (3-pass mutual auth)
- `usage/{usageId}`: Machine usage records
- `checkouts/{checkoutId}`: Payment/checkout records
- `machine/{machineId}`: Machine definitions
- `maco/{deviceId}`: Terminal device registrations
- `permission/{permissionId}`: Permission definitions

**CRITICAL: Always use DocumentReferences, not string paths**

```typescript
// Correct
await sessionRef.set({ userId: userDoc.ref });

// Wrong
await sessionRef.set({ userId: `/users/${userId}` });
```

**TTL retention contracts** (Firestore TTL policies in `firestore/firestore.indexes.json`):
- `loginCodes.expiresAt`: created + 5 min — auto-deletes consumed/expired magic-link codes.
- `authentications.ttlAt`: created + 5 min for in-progress auth; cleared (set to `null`) on successful completion so completed records are retained indefinitely.

### Canonical Firestore access (web apps)

All web reads and writes go through the typed builders in
`web/modules/lib/firestore-helpers.ts`. The hooks (`useDocument`,
`useCollection`) and the mutation API (`useFirestoreMutation`) accept
typed `DocumentReference<T>` / `CollectionReference<T>` only — string
paths are not accepted. Doc shapes live in
`web/modules/lib/firestore-entities.ts`. See
[`docs/adr/0023-canonical-firestore-access.md`](docs/adr/0023-canonical-firestore-access.md).

```tsx
import { useDb } from "@modules/lib/firebase-context"
import { userRef, machinesCollection } from "@modules/lib/firestore-helpers"
import { useDocument, useCollection } from "@modules/lib/firestore"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"

function MyPage({ userId }: { userId: string }) {
  const db = useDb()
  const { data: user } = useDocument(userRef(db, userId))
  const { data: machines } = useCollection(machinesCollection(db))
  const { update } = useFirestoreMutation()

  // Writes that point at another doc use the typed helpers too:
  return <Button onClick={() => update(userRef(db, userId), { foo: "bar" })} />
}
```

Do not redefine `*Doc` types inline — import them from
`@modules/lib/firestore-entities`.

## Local Development

One-command startup:

```bash
./dev.sh    # Installs deps, builds, starts emulators + both web apps
```

Or manually:

```bash
npm run dev              # Emulators + checkout + admin dev servers
npm run dev:checkout     # Checkout dev server only
npm run dev:admin        # Admin dev server only
npm run dev:gateway      # Gateway (separate terminal)
npm run seed             # Seed emulator with test data
```

**Services:**
- Emulator UI: http://localhost:4000
- Functions: http://localhost:5001
- Checkout app: https://localhost:5173
- Admin app: https://localhost:5174
- Hosting: http://localhost:5050
- Gateway: localhost:5000

## Testing

**Before committing / during code review — always run:**

```bash
npm run test:precommit   # Builds + tests both web apps and functions
```

This runs: web build (TypeScript + Vite for checkout & admin) → web unit tests → web integration tests (emulator auto-started) → functions build + unit + integration tests (emulator auto-started).

**Port-block broker (automatic):** `test:web:integration`, `test:web:e2e`,
and `functions test:integration` automatically wrap their emulator launch
in `scripts/port-block.ts`. The broker:

1. **Regenerates `.env` files** (`npx tsx scripts/generate-env.ts`) before
   anything else, *if* the operations repo is cloned as a sibling.
   Without this, a stale `.env` (new param in the operations config
   not yet in `functions/.env.local`) makes Firebase prompt
   interactively during emulator startup and the test hangs forever.
   On CI runners that don't have the operations repo cloned, the
   broker prints a skip notice and proceeds — env files are expected
   to be materialized by the workflow itself. Nested broker
   invocations also skip this step.
2. Acquires the lowest-numbered free CI block (5 blocks of +10000),
   generates an offset `firebase.runtime.<block>.json`, sets emulator
   port env vars, and execs the test runner.

Concurrent test runs (parallel CI / multiple agent worktrees) get
distinct port blocks and do **not** collide. If all 5 blocks are held
the broker exits with code `75` (EX_TEMPFAIL) so the caller can retry.
Manual `npm run dev` is unaffected — the broker only fronts test paths.
See [`docs/port-blocks.md`](docs/port-blocks.md).

To wrap any other `firebase emulators:exec` invocation in the broker
manually, prefix with `npm run block --`. The broker is nesting-safe:
if `PORT_BLOCK` is already set in the env, it re-uses the parent's
block instead of acquiring another.

```bash
# Web unit tests only (Vitest, no emulator needed)
cd web && npm test

# Web integration tests (Firestore security rules, emulator auto-started)
npm run test:web:integration

# Web E2E tests (Playwright, emulators auto-started for Firestore+Auth+Functions)
npm run test:web:e2e

# Functions tests (unit + integration; Firestore+Auth+Storage emulators
# auto-started — PDF paths are exercised against real Storage)
cd functions && npm test

# All unit tests (web + functions, no emulators)
npm run test:all
```

**Screenshot tests (Playwright visual regression):**

E2E tests use `toHaveScreenshot()` for pixel-level layout regression detection. Tests run at **two viewports** automatically: desktop (`chromium`, 1280×720) and mobile (`mobile-chrome`, 375×812 with touch). Reference snapshots are stored in `web/apps/checkout/e2e/*.spec.ts-snapshots/` and checked into git — both `*-chromium-linux.png` and `*-mobile-chrome-linux.png` baselines.

```bash
# Update snapshots after intentional UI changes (run from repo root):
npm run block -- bash -c 'firebase emulators:exec --config "$FIREBASE_E2E_CONFIG" \
  --only firestore,auth,functions \
  "cd web/apps/checkout && npx playwright test checkin-screenshots checkout-screenshots --update-snapshots"'
```

New screenshot tests automatically run at both viewports — no extra configuration needed.

**Test locations:**
- `web/apps/checkout/src/**/*.test.{ts,tsx}` — Checkout unit tests (Vitest)
- `web/apps/admin/src/**/*.test.{ts,tsx}` — Admin unit tests (Vitest)
- `web/modules/**/*.test.{ts,tsx}` — Shared module unit tests (Vitest)
- `web/modules/**/*.integration.test.ts` — Firestore security rules tests (Vitest + emulator)
- `web/apps/checkout/e2e/*.spec.ts` — E2E browser tests (Playwright + emulators)
- `web/apps/checkout/e2e/*.spec.ts-snapshots/` — Screenshot baselines for visual regression tests
- `functions/src/**/*.test.ts` — Functions unit tests (Mocha)
- `functions/test/integration/` — Functions integration tests (Mocha + emulator)

**The Firestore emulator does not enforce indexes.** A `collectionGroup(...)` query needs a `COLLECTION_GROUP`-scope entry in `firestore/firestore.indexes.json` `fieldOverrides` (pattern: `items.tokenId`, `invites.email`) or it throws `FAILED_PRECONDITION` on real projects — while passing every emulator-backed test. When adding a collection-group query, add the fieldOverride in the same PR and deploy with `firebase deploy --only firestore:indexes` to both projects. (This shipped a broken pending-invites banner past the full test suite in July 2026.)

**When adding a new owner-scoped Firestore collection,** add cross-user negative tests to `web/modules/test/cross-user-rules.integration.test.ts` (matrix: other-user read/write/delete, anon, tag-tap, admin carve-out). This file is the regression net for the B2 launch-readiness incident (cross-user `checkouts` read leak) — it must fail loudly if any owner-scoped rule is ever loosened.

## Web Application

npm workspace with two React SPAs and shared modules (Vite + TanStack Router + shadcn/ui + Tailwind):

- `web/apps/checkout/` — Public checkout, user self-service (`@oww/checkout`)
- `web/apps/admin/` — Admin dashboard (`@oww/admin`)
- `web/modules/` — Shared Firebase, hooks, UI components (`@oww/modules`)

```bash
cd web
npm install               # Installs all workspace deps
npm run build             # Builds all workspaces
npm run dev:checkout      # https://localhost:5173
npm run dev:admin         # https://localhost:5174
```

**Key Patterns:**
- Client-side Firestore (no custom backend)
- Account claiming (pre-create users, link on sign-in)
- Three access modes: public (token/NFC), authenticated (email sign-in), admin
- Role-based access (`admin`, `vereinsmitglied`)
- German UI throughout
- Firebase Auth custom claims for Firestore security rules

**Async mutations:** All async writes go through `useAsyncMutation` (or
`useFirestoreMutation` for typed Firestore writes — it delegates).
The hook owns the toast; callers MUST NOT add their own `toast.error`
after `await mutate(...)`. On failure the hook re-throws, so callers
short-circuit and MUST NOT advance UI state. Failures fire telemetry
to `logClientError`. See [ADR-0025](docs/adr/0025-async-mutation-error-handling.md).

**Calling Cloud Functions:** Web callables are grouped into four domain
dispatchers (`authCall`, `membershipCall`, `billingCall`, `catalogCall`) to
share warm instances and cut cold starts (#277). Call them through
`rpcCallable(functions, group, method)` from `@modules/lib/rpc` — it mirrors
`httpsCallable` (you still `await fn(payload)` and read `.data`). Do NOT call
`httpsCallable` directly for these; the individual function names no longer
deploy. The method string must match a key in that dispatcher's `HANDLERS` map
(`functions/src/*/dispatcher.ts`). The one exception is `logClientError`, which
stays a standalone `httpsCallable`. All functions run in `europe-west6`
(`getFunctions(app, "europe-west6")`). See
[ADR-0028](docs/adr/0028-grouped-callable-dispatchers.md).

**Deploy:**
```bash
firebase deploy --only hosting           # Both sites
firebase deploy --only hosting:checkout  # Checkout only
firebase deploy --only hosting:admin     # Admin only
```

See [`docs/deployment-checklist.md`](docs/deployment-checklist.md) for production deployment steps.

## Implementation Guidelines

**When encountering blockers:**

If an issue requires a significant workaround (global state hacks, skipping functionality, architectural compromises), **stop and discuss it** instead of implementing the workaround. Explain:
1. What you're trying to do
2. What's blocking you
3. What workaround you'd consider and its downsides

This allows deciding together whether to accept the workaround, find a better solution, adjust the design, or defer the feature.

## Codestyle

**Copyright Header (all new files):**

```cpp
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
```

- Google C++ style guide
- `snake_case` file naming
- Comments describe **why**, not what changed
- Avoid generic "Manager" suffixes
