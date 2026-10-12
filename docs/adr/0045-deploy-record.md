# ADR-0045: Deploy record — git tags, an ops-repo log and a generated state page

**Status:** Accepted (phase 1 implemented; phases 2–3 planned)

**Date:** 2026-10-12

## Context

The system deploys to many places: Firebase staging and prod (functions,
rules, hosting), the gateway Pi, the checkout-kiosk PC and every MACO
terminal. Until now no deploy left a trace, so "what runs where?" was
answered from memory. The gcloud audit logs and the Firebase Hosting
release history do record Firebase deploys, but without the commit, spread
across consoles, and not at all for the gateway, the kiosk or the devices.

No component knows which version it is running either: firmware has no
build stamping, the gateway ships an unversioned tarball, the web apps and
functions carry no commit, and the kiosk only shows its `package.json`
version in a tray tooltip.

## Decision

**Phase 1a — only the latest main ships (`scripts/deploy-preflight.ts`).**
Every deploy path refuses to start unless machine-auth *and* the operations
repo (whose working tree supplies `config.jsonc` and the staging overlay)
are on `main`, equal to `origin/main`, with no uncommitted changes to
tracked files. For the gateway and the firmware, whose builds include
`third_party/pigweed`, submodules must also sit at the commit `main`
records. The override is explicit — `--allow-off-main` (deploy.sh,
deploy-gateway.ts) or `DEPLOY_ALLOW_OFF_MAIN=1` (`./pw prod-flash`, the
kiosk build) — and the deploy record lists what was off (`offMain`,
"⚠️ off main" in `STATE.md`). It applies to staging too: deploying a
branch to staging is legitimate, but it should be a visible choice.

**Phase 1b — record every deploy where it happens (`scripts/deploy-record.ts`).**
The deploy paths call it after they succeed: `scripts/deploy.sh`
(component `firebase`), `scripts/deploy-gateway.ts` (`gateway`, target =
host), the kiosk `build:kiosk:{staging,prod}` scripts (`kiosk`) and
`./pw prod-flash` (`firmware`, target = USB device id). Manual steps
(secret rotation, migration scripts, config changes, restores) are logged
with `deploy-record.ts event --env … --note …`. Each record:

- tags the deployed commit `deploy/<env>/<component>/<YYYYMMDD-HHMMSS>` —
  not for a dirty working tree, where the tag would name code that did not
  go out. The tag is pushed only after the log entry is safe, and only if
  the commit already is on an origin branch, so a deploy from an unpushed
  commit never publishes it as a side effect;
- appends one JSON line to `deploys/log.jsonl` on the private operations
  repo's `main` — the source of truth — and regenerates its `STATE.md`
  (current state per component/env/target, staging-vs-prod and
  main-vs-prod commit counts, full history).

The operations checkout is never touched (it may sit on a smoke branch
with uncommitted edits): the commit is made in a throwaway worktree of
`origin/main`, and a rejected push is retried on a freshly fetched `main`
by re-applying the entry — no rebase that could stop half-way. Offline,
the entry waits in `.git/deploy-record-pending.jsonl` and the next run
sends it. Recording is best effort: a deploy that went out is never
reported as failed because GitHub was unreachable. `deploy.sh` snapshots
the commit and dirtiness before it starts, so the record describes what
was deployed.

**Phase 2 — components report what they run.** Functions return their
commit on `ping`; the web apps get a build-time commit; the gateway ships a
`VERSION` file and records itself; firmware gets Bazel stamping and sends
its version on the gateway `Ping`, which the gateway stores as
`maco/{deviceId}.firmwareVersion` / `lastSeen`; the kiosk exposes its
version over the preload bridge.

**Phase 3 — drift.** `deploy.sh` and `deploy-record.ts render` read the
running versions, add them to `STATE.md` and warn (never block) when a
component lags the latest release or has not been seen for a while. Each
admin app gets a live "Versionen" page for its own project.

## Consequences

**Pros:**
- A deploy can always be reconstructed from its commit and the operations
  repo's `main` at that time — no local edits, no stale branch.
- `git log <latest prod tag>..main` answers "what is not in prod yet";
  `STATE.md` answers "what runs where" without anyone maintaining it.
- Works for every component, including the ones gcloud cannot see.
- The overview is private (operations repo) and rendered by GitHub, also on
  a phone.

**Cons:**
- Every deploy needs both checkouts switched to an up-to-date `main` first;
  the operations checkout often sits on a smoke branch.
- Deploy tags accumulate in the public repo (one per deploy, not per device).
- Until phase 2, the record says what was *deployed*, not what *runs*: the
  gateway needs a manual service restart, the kiosk installer a manual
  install.
- A firmware flash whose device id could not be read (not exactly one USB
  device) appears in the history only, not as a current row.

**Tradeoffs:**
- *Google Sheet:* the scripts cannot append to it without OAuth plumbing,
  so it would be maintained by hand and drift; no link to commits.
- *Hand-written Markdown changelog:* same drift problem.
- *GitHub Pages:* not available for private repos on the organisation's
  free plan, and even paid Pages are public outside Enterprise Cloud.
- *Firestore-only log shown in the admin app:* each project would only see
  its own deploys, and gateway/kiosk/firmware deploys have no natural
  project. The admin page complements `STATE.md` instead (phase 3).
