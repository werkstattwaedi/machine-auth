# ADR-0027: Shared TypeScript package (`@oww/shared`)

**Status:** Accepted

**Date:** 2026-05-22

## Context

The repository contains several TypeScript packages that need to agree on
some of the same types and pure functions:

- `web/apps/*` and `web/modules/` — React SPAs bundled by Vite, depend on
  the Firebase **client** SDK.
- `functions/` — Cloud Functions running on Node, depend on the Firebase
  **admin** SDK.
- `checkout-kiosk/` — Electron app that bridges USB/network hardware to
  the web apps it hosts.

Historically each package owned its own copies of any shared concept
(catalog/pricing types, future bridge protocol envelopes, future label
printer encoder). The packages can't trivially share source via simple
relative imports: they have different `tsconfig` roots and different
runtime targets, and any module that pulls in `firebase` (admin **or**
client), `electron`, Node-only APIs, or DOM-only APIs becomes
unimportable from one or more of the others.

## Decision

We maintain a single top-level npm workspace, **`@oww/shared`**, at
`shared/`. Anything that genuinely needs to be the same in two or more
of the consuming packages goes here. Each consumer declares
`"@oww/shared": "*"` and imports normally; the package emits compiled
JavaScript + `.d.ts` so the Node and Cloud Functions runtimes can load
it without a bundler.

The repository root owns the `workspaces` field. Sub-packages don't
re-declare their own workspaces.

### What may live in `@oww/shared`

Hard constraints — code that violates any of these belongs in a
consuming package instead:

- No `firebase` / `firebase-admin` imports. SDK-typed `Timestamp` or
  `DocumentReference` only exists on one side of the wire; shared code
  must operate on plain wire-format values.
- No `electron` imports.
- No Node-only APIs (`fs`, `path`, `child_process`, …).
- No DOM-only APIs.
- Runtime dependencies are minimised. Any new runtime dep must be
  usable in all four environments (Vite/browser, Node, Electron main,
  Electron renderer) and shouldn't pull large transitive trees.

### How sub-modules are organised

The package exports through a barrel (`shared/src/index.ts`). New
domains live in their own files or sub-folders (e.g. `pricing.ts`,
`bridge-protocol.ts`, `printer/`) so that consumers can tree-shake or
selectively re-export without dragging unrelated concerns along.

### Migration policy

Code earns its way in: a symbol is only worth promoting once it has at
least two real consumers, *or* a near-term consumer is about to land and
forcing it through the duplication round-trip would be wasted churn.
Don't move SDK-coupled types here just to centralise them — that's a
different problem (entity-type unification) and requires its own ADR if
it ever happens.

## Consequences

**Pros:**

- One source of truth for SDK-agnostic types and pure helpers.
- The constraints are mechanical to enforce (just look at the imports)
  and keep the package safe for every current and likely-future
  consumer.
- New cross-package code has a documented home, which removes a
  recurring "where does this go?" decision from PR review.

**Cons / costs the design pays:**

- Build order matters: every consumer's TypeScript build needs
  `@oww/shared` built first. Consumers encode this with a `prebuild`
  hook or a build-orchestration script.
- The constraints rule out anything coupled to a specific runtime,
  which is fine for types and pure functions but means richer shared
  abstractions (e.g. a Firestore data-access layer) can't live here.
- Workspace install model: contributors install dependencies at the
  repo root, not in subdirectories. Existing per-package install
  habits no longer apply.

**Firebase Functions deploy:**

`firebase-tools` does **not** resolve workspace deps when packing a
function bundle — Cloud Build's `npm install` tries to fetch
`@oww/shared@*` from the public registry and 404s. `npm install
--no-save <tarball>` from inside the `functions/` workspace doesn't
help either: npm walks up to the root `package.json`, sees `functions`
listed as a workspace member, and re-creates the symlink instead of
installing from the tarball.

The shipping fix lives in `scripts/prepare-functions-deploy.ts`,
invoked as a Firebase predeploy hook (`functions[].predeploy` in
`firebase.json`). It packs `shared/` into
`functions/oww-shared-X.Y.Z.tgz` and rewrites `functions/package.json`
so `@oww/shared` points at the tarball via `file:`. Cloud Build then
installs from the local tarball.

The mutation persists until cleanup. Two paths:

- `npm run deploy:functions` — the wrapper script
  (`scripts/deploy-functions.ts`) runs `firebase deploy --only functions
  [args...]` and restores `functions/package.json` + removes the tarball
  on exit (including on failure or Ctrl+C). Snapshots the pre-deploy
  bytes so it works regardless of whether `HEAD` is clean.
- `firebase deploy --only functions` — the predeploy still does the
  prep, and the deploy still succeeds, but the dirty state stays in the
  working tree. Run `npm run deploy:functions:cleanup` afterwards. The
  Husky pre-commit hook refuses commits while the dirty state is in
  effect, so the modified `package.json` can't leak into git.

## When to re-evaluate

This decision should be revisited if any of the following becomes true:

- The "no SDK / no Electron / no Node / no DOM" constraint starts
  rejecting code that has multiple genuine consumers — i.e. we keep
  finding ourselves wanting to share something that *can't* satisfy the
  rules. That's a signal we need a richer model (per-runtime adapters
  shipped from one package, or per-runtime sub-packages).
- We undertake full Firestore entity-type unification across the
  client/admin SDK divide. Generating types from
  `firestore/schema.jsonc` or proto becomes attractive once the
  volume of shared entity shapes is large enough; the codegen pipeline
  is heavyweight and isn't justified for hand-written pure helpers.
- npm workspaces stop working with whichever Firebase / build tooling
  we're using. The deploy fallback handles this for Functions, but a
  broader workspace incompatibility would warrant a different sharing
  mechanism.

## Alternatives considered

- **Copy-on-prebuild.** A canonical file in one consumer copied into the
  others by a prebuild script. Rejected because IDE go-to-def jumps to
  the generated copy, diffs are noisy, and the editor experience is
  meaningfully worse than a real package — and these costs only grow
  with the number of shared symbols.
- **Sub-workspace under `web/`.** Put shared code inside the web tree
  and have functions and the kiosk consume it across packages.
  Rejected because non-web consumers reaching *into* the web tree is
  architecturally backwards and brittle: web is the largest, most
  churn-prone consumer, not the natural owner of cross-cutting code.
- **Schema-generated types.** Generate Firestore entity shapes from a
  single schema file. Deferred rather than rejected — it's the most
  likely successor model if entity-type unification becomes a goal, but
  it's overkill for pure functions and string-literal unions, which is
  what `@oww/shared` holds today.
