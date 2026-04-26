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

**CRITICAL: 100,000 operations/month maximum** (Firebase free tier)

Design decisions to minimize operations:
1. Terminal-side permission checking after session established
2. Local session caching
3. Batch usage uploads
4. Future: Session broadcasting between devices

### Firebase Functions

All code in `functions/`

```bash
cd functions/
npm run build          # Build
npm run serve          # Local emulator
npm run test           # All tests
firebase deploy --only functions
```

**Clean rebuild if stale:**
```bash
rm -rf lib/ && npm run build
```

### Firestore Schema

See `firestore/schema.jsonc` for complete structure.

**Key Collections:**
- `users/{userId}`: User profiles (doc ID != Firebase Auth UID)
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

**Important:** Stop the dev emulators (`npm run dev`) before running integration/E2E tests — concurrent emulator instances cause data isolation issues.

```bash
# Web unit tests only (Vitest, no emulator needed)
cd web && npm test

# Web integration tests (Firestore security rules, emulator auto-started)
npm run test:web:integration

# Web E2E tests (Playwright, emulators auto-started for Firestore+Auth+Functions)
npm run test:web:e2e

# Functions tests (unit + integration, emulator auto-started)
cd functions && npm test

# All unit tests (web + functions, no emulators)
npm run test:all
```

**Screenshot tests (Playwright visual regression):**

E2E tests use `toHaveScreenshot()` for pixel-level layout regression detection. Tests run at **two viewports** automatically: desktop (`chromium`, 1280×720) and mobile (`mobile-chrome`, 375×812 with touch). Reference snapshots are stored in `web/apps/checkout/e2e/*.spec.ts-snapshots/` and checked into git — both `*-chromium-linux.png` and `*-mobile-chrome-linux.png` baselines.

```bash
# Update snapshots after intentional UI changes (run from repo root):
firebase emulators:exec --config firebase.e2e.json \
  --only firestore,auth,functions \
  'cd web/apps/checkout && npx playwright test checkin-screenshots checkout-screenshots --update-snapshots'
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
