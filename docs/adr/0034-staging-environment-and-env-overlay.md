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

Emulator-vs-real selection is unaffected: the web app gates emulator wiring on
`import.meta.env.DEV`, which Vite sets to `false` for any `vite build`
(including `--mode staging`) — so a staging build talks to the real staging
project, not emulators.

Staging gets its own Function secrets (test-grade keys, never prod tag keys)
and its own small set of NFC tags/devices pointed at the staging checkout
domain. All test/validation happens here; production only ever receives real
data.

## Consequences

**Pros:**
- Real HTTPS URLs, real Auth, real Functions for device/phone/NFC validation
  without localhost limitations.
- Production stays clean by construction — the "identify and delete test data"
  problem does not recur.
- DRY config: staging is a small delta file, not a full copy.
- Zero risk to the prod pipeline — the overlay writes only env-suffixed files.

**Cons:**
- A second Blaze project to operate (low usage, but real cost + secret upkeep).
- Staging secrets and tag/device provisioning must be maintained separately.

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
