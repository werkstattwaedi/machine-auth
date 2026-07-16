# ADR-0034: Staging environment via a config overlay

**Status:** Accepted

**Date:** 2026-07-06

## Context

Until launch the project ran a single Firebase project (`oww-maco`, now moved
into the `werkstattwaedi.ch` org). Validating changes required either localhost
+ emulators — which can't reproduce real-device flows (macOS quirks, phones,
NFC-SDM self-checkout URLs, real Auth/phone providers) — or testing directly
against the live project, which pollutes it with test users, tokens, and
checkouts. We want a real-URL environment to validate against that is
disposable and never touches production data.

Firebase's standard answer is one project per environment. The blocker was
tooling: `scripts/generate-env.ts` (ADR-0018) was hardwired to a single
`config.jsonc` → single `firebase.projectId`, and it fully rewrote
`.firebaserc` and the `.env.production` files on every run. There was no way to
produce a second, parallel env set without either duplicating the entire config
(drift risk) or clobbering the prod outputs.

## Decision

Add a **staging Firebase project** (`oww-maco-staging`) inside the org, and
teach `generate-env.ts` an **environment-overlay mode**: `--env <name>`.

- The overlay deep-merges `config.<name>.jsonc` (only the values that differ —
  `firebase.projectId`, the target project's SDK config, `web.*Domain`) over
  the base `config.jsonc`. One source of truth; staging carries only its deltas.
- It emits **only** the deploy-facing, env-suffixed files:
  `functions/.env.<projectId>` (the Firebase CLI auto-loads this when deploying
  with `--project <projectId>`) and `web/apps/*/.env.<name>` (consumed by a new
  Vite `staging` build mode, `npm run build:staging` → `vite build --mode
  staging`).
- It is **non-destructive**: it never rewrites `.env.production`, `.env.local`,
  or `.firebaserc`. Staging deploys target the project explicitly with
  `firebase deploy --project oww-maco-staging` rather than a `.firebaserc`
  alias, so the prod toolchain is completely undisturbed.
- The hosting predeploy hooks in `firebase.json` run
  `npm run ${WEB_BUILD_SCRIPT:-build}` — unset (prod) they behave exactly as
  before; staging hosting deploys must set the override so the bundle is built
  against the staging env:
  `WEB_BUILD_SCRIPT=build:staging firebase deploy --only hosting --project
  oww-maco-staging`. Without it, the predeploy would silently ship a
  prod-configured bundle to the staging sites.

Emulator-vs-real selection is unaffected: the web app gates emulator wiring on
`import.meta.env.DEV`, which Vite sets to `false` for any `vite build`
(including `--mode staging`) — so a staging build talks to the real staging
project, not emulators.

The overlay covers every deployable/runnable component. The full matrix:

| Component | dev (emulators) | staging | prod |
|---|---|---|---|
| Functions | `npm run serve` (`.env.local`) | `cd functions && npm run deploy -- --project oww-maco-staging` (`.env.oww-maco-staging`) | `cd functions && npm run deploy` |
| Web apps | `npm run dev:checkout` / `dev:admin` | `WEB_BUILD_SCRIPT=build:staging firebase deploy --only hosting --project oww-maco-staging` | `firebase deploy --only hosting` |
| Gateway | `npm run dev:gateway` (`.env.local`) | `npm run dev:gateway:staging` — a **local** gateway reading `maco_gateway/.env.staging` | `npx tsx scripts/deploy-gateway.ts` (Pi) |
| Kiosk | `npm run dev:kiosk` (localhost URL) | `npm run start:kiosk:staging` (local Electron) or `build:kiosk:staging` (packaged) | `npm run build:kiosk:prod` |

`generate-env.ts --env staging` emits the staging inputs for the first three
rows; `maco_gateway/.env.staging` additionally pulls
`GATEWAY_ASCON_MASTER_KEY`/`GATEWAY_API_KEY` from Secret Manager via gcloud
(skipped with a warning when gcloud is unavailable). The gateway selects its
env file by name via `GATEWAY_ENV` (default `local`). The kiosk's
`inject-build-config.mjs --env <name>` deep-merges the same overlay file the
env generator reads, so the kiosk URL follows `web.checkoutDomain`
automatically; its bearer always comes from Secret Manager.

Staging **shares production's Function secrets** (same Secret Manager values,
copied into the staging project): both projects sit in the same org with the
same access controls, so a separate key set adds upkeep without a security
boundary — and sharing `DIVERSIFICATION_MASTER_KEY`/`TERMINAL_KEY` means
already-personalized NFC tags authenticate against staging without
re-personalization, which is precisely the integration we want to test. All
test/validation happens here; production only ever receives real data.

## Consequences

**Pros:**
- Real HTTPS URLs, real Auth, real Functions for device/phone/NFC validation
  without localhost limitations.
- Production stays clean by construction — the "identify and delete test data"
  problem does not recur.
- DRY config: staging is a small delta file, not a full copy.
- Zero risk to the prod pipeline — the overlay writes only env-suffixed files.

**Cons:**
- A second Blaze project to operate (low usage, but real cost).
- Secret rotation must be applied to both projects (values are shared).
- Device provisioning (maco terminals) must still be pointed at staging
  explicitly; only tags carry over for free.

**Tradeoffs:**
- *Separate full config dir* (`OPERATIONS_CONFIG_DIR=…/staging`): no code
  change, but two full configs drift over time. Rejected for the overlay's
  single-source-of-truth.
- *`.firebaserc` aliases* (`firebase use staging`): idiomatic, but would make
  `generate-env` rewrite the shared `.firebaserc`, coupling staging generation
  to the prod file. Rejected in favor of explicit `--project` on deploy.
- *Reuse `.env.production` for staging builds*: simplest, but a single Vite
  production env file can't hold both prod and staging values. Rejected for a
  dedicated `staging` mode.

Builds on [ADR-0018](0018-json-config-env-generation.md).
