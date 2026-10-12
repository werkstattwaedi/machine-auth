# ADR-0045: Deploy record and release versions

**Status:** Accepted (phase 1 implemented); phases 2–3 proposed

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

A record of deploys also isn't a record of what *runs*. The gateway picks up
a deploy only after a manual `systemctl restart`, the kiosk installer is
installed by hand, a terminal runs whatever was last flashed onto it, and a
browser tab can keep an old web bundle for days. A commit hash identifies a
build exactly, but people can't talk about one ("is the kiosk on 1a2b3c4 or
9f8e7d6?"). We need a name for a release that people can read and that every
component reports in the same form.

Constraints for reporting:
- Firestore Spark allows 20K writes/day. A terminal pings the gateway every
  15 s, so writing `lastSeen` per ping (~5,760 writes per device per day)
  is ruled out.
- `maco/{id}` is admin-edited and audited; machine-written status must not
  land there.
- The repo is public. `/api/ping` and the dispatcher ping are
  unauthenticated by design (ADR-0037) and return no data today.

## Decision

### Phase 1a — only the latest main ships (`scripts/deploy-preflight.ts`)

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

### Phase 1b — record every deploy where it happens (`scripts/deploy-record.ts`)

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

### Phase 2a — one release version for the whole repo

Releases are named `YYYY.M.N`: the Nth release in that month, with N
restarting each month (`2026.10.1`, `2026.10.2`, `2026.11.1`). The name
says roughly how old a release is and is valid semver, which electron-builder
and npm need. The tag is `v2026.10.2`.

A release is a **machine-auth commit**: one version covers firmware, gateway,
kiosk, web and functions, because they all build from the same tree. Several
releases in a day just increment N. Deploying a commit a second time
(staging → prod, another terminal) reuses its tag. The deploy tags from
phase 1b stay: the release tag names *what*, the deploy tags *where and when*.

Every build computes its version with one script, `scripts/build-version.ts`,
based on `git describe --tags --match 'v*' --dirty`:

| Build | Version |
|---|---|
| exactly a release tag, clean | `2026.10.2` |
| later commit | `2026.10.2-dev.7+g1a2b3c4` |
| uncommitted changes | `2026.10.2-dev.7+g1a2b3c4.dirty` |
| local firmware dev build | `dev` (fixed, so it doesn't rebuild on every commit) |

The kiosk moves from `1.0.14` to `2026.10.x`, an upgrade for the NSIS
updater; its Windows file version becomes `2026.10.2.0`.

**Releases are cut at the first deploy, after a confirmation.** When a
deploy path is about to build an untagged commit, it proposes the next name
and lists the commits since the previous release:

```
New release v2026.10.3 from 1a2b3c4 — 4 commits since v2026.10.2:
  1a2b3c4 fix(kiosk): keep cart on badge switch (#712)
  …
Cut v2026.10.3 and deploy? [y/N]
```

- The commit list becomes the tag's annotation, so `git show v2026.10.3`
  shows the release notes.
- For `deploy.sh prod` this question replaces the "Deploy to PRODUCTION?"
  confirmation, so there is only one prompt.
- `--yes` answers it. With no terminal and no `--yes`, the deploy stops
  rather than cut a release silently. Answering no aborts the deploy
  before anything is built, and nothing is tagged.
- The tag is pushed before the build starts. If two deploys race for the
  same name, the loser fetches the tags and either reuses the winner's
  tag (same commit) or takes the next N.
- A deploy with `--allow-off-main` or from a dirty tree never cuts a
  release; it ships a `-dev` version and is recorded as off main.

**The operations repo is recorded by its config revision, not versioned.**
It gets a commit for every deploy (`deploys/log.jsonl`, `STATE.md`), so its
HEAD says nothing about config. Each deploy record therefore stores
`opsRevision`: the last operations commit that touched anything **outside**
`deploys/` and `STATE.md`. When it changed since the previous release, the
release prompt says so ("operations config changed since v2026.10.2: 2
commits"). A config-only change does not cut a new release automatically;
`--new-release` cuts the next N on the same machine-auth commit when it
should get its own name.

### Phase 2b — components report their version

| Component | Where the version comes from | How it reports |
|---|---|---|
| Functions | build-info file generated at deploy | `/api/ping` and the dispatcher ping return `{ok, version}` |
| Web apps | Vite `define` + static `/version.json` | admin footer; `logClientError` sends it (`serviceContext.version`, #586) |
| Gateway | `VERSION` file written by `deploy-gateway.ts` | its heartbeat |
| Firmware | `pw_build_info` workspace-status stamping, `build:prod` only | `GetDeviceInfo`; new optional `PingRequest` fields `version`, `boot_count`, `reset_reason` sent to the gateway |
| Kiosk | build-time version, `bridge.version` | its status report |

Returning the version on the public ping is a deliberate minor disclosure:
the repo and its tags are public anyway.

### Phase 2c — status reports and liveness

**Where status lives.** Each device has one status document, overwritten in
place, in a `status` subcollection under its own path:

- terminals: `maco/{deviceId}/status/current`
- gateway: `gateways/{gatewayId}/status/current`
- kiosk: `kiosks/{kioskId}/status/current`

Fields: version, online, first/last seen, boot count, reset reason. The
audit trigger matches `maco/{docId}` only, so status writes neither touch
the admin-edited terminal document nor fill the audit log. `gateways` and
`kiosks` have no documents of their own yet (ids come from the operations
config); they are the natural place for per-device config or credentials
later. One `collectionGroup("status")` query reads all of them. The
`status` subcollections get a `subject_data_map` entry (devices, no
subject data), rules allowing admin reads only, and no client writes. (Not
"check-in": that word belongs to member visits.)

**Gateway heartbeat, every 5 minutes, around the clock.** The gateway posts
`POST /api/device-status` (bearer `GATEWAY_API_KEY`) with its own state and
that of every terminal it knows: version, boot count and reset reason from
the new `PingRequest` fields, and whether the terminal still pings. The
route lives on the `api` function, so the heartbeat also keeps that
function warm — around the clock instead of every 10 minutes in opening
hours — and replaces the warm pinger (ADR-0037) and its `WARM_SCHEDULE`
entirely. An idle instance without `minInstances` costs nothing. A terminal that misses its 15 s pings for a minute, comes
back, or reboots is reported **at once**, not at the next heartbeat. The
gateway identifies itself by `gatewayId` from the operations config; the
API key is shared, so a gateway could claim any id. Per-gateway
credentials are deferred until there is a second gateway.

**Writes only on change.** The function compares each report with the
stored document and writes when something changed (version, online, boot
count; a crash loop coalesced to one write per hour) and otherwise
refreshes `lastSeen` at most hourly. That is about 24 writes per device
per day, ~150 for a gateway with five terminals; the 5-minute beat itself
costs no writes.

**Alerting.**
- *Gateway missing:* every heartbeat writes one structured INFO log line
  (`event: "gateway_heartbeat"`). A log-based metric with a Cloud
  Monitoring **metric-absence** condition alerts after 15 minutes, i.e.
  three missed heartbeats. It covers a dead Pi, a crashed service and a
  lost internet connection alike — in each case nobody can see the
  workshop. No Firestore writes, no scheduled function.
- *Terminal offline:* when a terminal drops out, the function logs
  `event: "terminal_offline"` (WARNING, so it also shows up in the daily
  digest), and a log-match alert policy fires on that event within
  minutes. It matches the event, not the severity, so the severity policy
  (ERROR only for real faults) stays intact. Terminals are assumed to stay
  powered around the clock, so there are no opening hours to model; if
  that changes, the alert needs a schedule.
- Both policies exist in prod only and use the existing notification
  channel (#587).

**Kiosk.** The checkout app in kiosk mode calls `authCall` method
`reportKioskStatus` (kiosk bearer) on load, at most once per version or per
24 h (timestamp in browser storage). The kiosk PC is switched off after
hours, so it gets no absence alert.

### Phase 3 — where it shows, and drift

- **Admin "Versionen" page** (per project): every status document with its
  version, online state, last seen and "behind the latest release" flag,
  next to that project's functions and web versions.
- **Drift:** `deploy-record.ts render` and `deploy.sh` read the status
  documents and add "running" next to "deployed" in `STATE.md`. They warn,
  never block, when a device lags the latest release.

Rollout order: build provenance (2a + 2b), status reports and alerting
(2c), the Versionen page, drift.

## Consequences

**Pros:**
- A deploy can always be reconstructed from its commit and the operations
  repo's `main` at that time — no local edits, no stale branch.
- `git log <latest prod tag>..main` answers "what is not in prod yet";
  `STATE.md` answers "what runs where" without anyone maintaining it.
- Works for every component, including the ones gcloud cannot see.
- The overview is private (operations repo) and rendered by GitHub, also on
  a phone.
- Everyone talks about the same thing: "the kiosk is on 2026.10.2, prod on
  2026.10.3", and the tag's annotation says what changed between them.
- What *runs* becomes visible, not just what was deployed: a gateway that
  was never restarted, a kiosk installer that was never installed, a
  terminal that was never reflashed — at a negligible write budget, with
  `maco/{id}` staying admin-only.
- A dead gateway or a terminal that drops out raises an alert within
  minutes instead of being noticed by the next member who taps a badge.

**Cons:**
- Every deploy needs both checkouts switched to an up-to-date `main` first;
  the operations checkout often sits on a smoke branch.
- Deploy tags accumulate in the public repo (one per deploy, not per device).
- Until phase 2c, the record says what was *deployed*, not what *runs*.
- Every deploy of a new commit asks one more question (or needs `--yes`).
- Release tags accumulate too, one per released commit.
- A config-only change doesn't get a new name unless someone asks for one.
- A shared gateway API key means a status report can't prove which
  gateway sent it.
- While the gateway is down, terminal status is stale; the gateway alert
  covers that window.
- The gateway calls a function every 5 minutes around the clock (~290
  invocations/day, inside the free tier).
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
- *SemVer by hand:* no one decides what counts as "minor" for a
  multi-component system, and the numbers would drift between components.
- *Per-component versions:* "kiosk 1.4 + firmware 0.9" says nothing about
  compatibility; one tree, one version.
- *Commit hash only:* exact, but unreadable and unordered. It stays in the
  `-dev` build metadata.
- *Versioning the operations repo too:* its HEAD moves with every deploy
  record, so it would cut a release per deploy. `opsRevision` keeps the
  link without the noise.
- *`lastSeen` on every ping:* ~5,760 writes per device per day, over the
  Spark quota with four terminals.
- *Logs only (no documents):* cheap, but neither the admin page nor
  `STATE.md` can query Cloud Logging without extra IAM, and logs expire
  after 30 days. Logs carry the liveness signal; documents carry the
  state.
- *A top-level `checkins` collection:* one place for everything, but
  "check-in" already means a member visit, and terminal status belongs
  next to its terminal.
- *Detecting a missing gateway with a scheduled function over `lastSeen`:*
  needs a write per heartbeat (288/day) plus a function on a timer;
  Cloud Monitoring's absence condition does it from the log line for free.
