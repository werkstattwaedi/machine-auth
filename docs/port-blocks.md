# Port blocks (parallel test isolation)

For automated test runs the Firebase emulator suite needs unique ports per
concurrent run. The default emulator config in [`firebase.e2e.json`](../firebase.e2e.json)
uses one fixed port set (firestore=8180, auth=9199, functions=5101); two
test runs colliding on those ports cause the second to fail with
`Could not start … port taken`. This is especially common in WSL2, where
ports bound by Windows or another distro can transparently appear in use.

`scripts/port-block.ts` is a tiny broker that picks the first free
**block** of CI ports, generates an offset Firebase config for that
block, sets the emulator port env vars, and exec's the wrapped command.
The lock socket is held for the lifetime of the broker process — when
the child exits, the kernel releases the socket. Crash-safe; no stale
lock files.

The broker also runs `npx tsx scripts/generate-env.ts` on first-level
invocations, before acquiring a block — *if* the operations repo
(`../machine-auth-operations/config.jsonc`, or
`$OPERATIONS_CONFIG_DIR/config.jsonc`) is present. A stale `.env`
(e.g. a new param added to the operations config that hasn't
propagated to `functions/.env.local`) makes Firebase prompt
interactively for the missing value during emulator startup, and the
test hangs forever — the auto-regen prevents that for local dev.

On CI runners that don't clone the operations repo, the broker prints
`[port-block] Skipping generate-env (no operations config at …)` and
proceeds. Env files are expected to be materialized by the CI workflow
itself (committed fixtures, secrets injection, etc.). Nested broker
invocations also skip the regen — the parent already handled it.

## Usage

The broker is **mandatory and automatic** for the standard test scripts —
they wrap themselves in `scripts/port-block.ts`. Just run them:

```bash
npm run test:web:integration   # broker fires automatically
npm run test:web:e2e           # broker fires automatically
cd functions && npm run test:integration   # broker fires automatically
```

For other `firebase emulators:exec` invocations (e.g. updating
Playwright snapshots), wrap manually:

```bash
npm run block -- bash -c 'firebase emulators:exec --config "$FIREBASE_E2E_CONFIG" --only firestore,auth,functions "..."'

# Or directly:
npx tsx scripts/port-block.ts -- <command> [args...]
```

The broker is **nesting-safe**: if `PORT_BLOCK` is already set in the
env, it skips acquisition and just exec's the child. So
`npm run block -- npm run test:web:integration` does not double-acquire.

Manual dev (`./dev.sh`, `npm run dev`) is **not** affected — it still
uses the default ports from `firebase.json`. The broker only fronts
emulator-exec test paths.

## Block layout

| Block  | Offset  | Lock port | Firestore | Auth   | Functions |
|--------|---------|-----------|-----------|--------|-----------|
| `dev`  | 0       | n/a       | 8080      | 9099   | 5001      |
| (e2e default) | 0 | n/a       | 8180      | 9199   | 5101      |
| `ci-1` | +10000  | 14040     | 18180     | 19199  | 15101     |
| `ci-2` | +20000  | 24040     | 28180     | 29199  | 25101     |
| `ci-3` | +30000  | 34040     | 38180     | 39199  | 35101     |
| `ci-4` | +40000  | 44040     | 48180     | 49199  | 45101     |
| `ci-5` | +50000  | 54040     | 58180     | 59199  | 55101     |

Block list is in [`scripts/port-blocks.json`](../scripts/port-blocks.json) —
add more blocks there if you need higher concurrency.

## What the broker exports

When a block is acquired, the wrapped command sees these env vars:

| Var | Example value | Used by |
|---|---|---|
| `PORT_BLOCK` | `ci-1` | Logging, debugging |
| `PORT_OFFSET` | `10000` | Anything that needs the raw offset |
| `FIREBASE_E2E_CONFIG` | `firebase.runtime.ci-1.json` | `scripts/emulator-exec.sh`, `functions/test:integration` |
| `EMULATOR_KILL_PORTS` | `15101,18180,19199,14400,14500` | `scripts/emulator-exec.sh` |
| `EMULATOR_AUTH_PORT` | `19199` | Functions / scripts |
| `EMULATOR_FIRESTORE_PORT` | `18180` | Functions / scripts |
| `EMULATOR_FUNCTIONS_PORT` | `15101` | Functions / scripts |
| `VITE_EMULATOR_AUTH_PORT` | `19199` | `web/modules/lib/firebase.ts` |
| `VITE_EMULATOR_FIRESTORE_PORT` | `18180` | `web/modules/lib/firebase.ts` |
| `VITE_EMULATOR_FUNCTIONS_PORT` | `15101` | `web/modules/lib/firebase.ts` |

The runtime Firebase config (`firebase.runtime.<block>.json`) is removed
when the broker exits.

## Exit codes

| Code | Meaning |
|---|---|
| `<child code>` | Wrapped command exited normally |
| `64` (EX_USAGE) | Missing `--` separator in argv |
| `70` (EX_SOFTWARE) | Internal broker error |
| `75` (EX_TEMPFAIL) | All blocks held — workqueue may retry |
| `78` (EX_CONFIG) | Missing `firebase.e2e.json` or `port-blocks.json` |
| `127` | Failed to spawn child |

The `75` exit is the one to watch for in your workqueue: if every block
is busy, sleep + retry instead of giving up.

## Contract

(b) — services in this distro **only** ever go through the broker for the
isolated test paths. Manual dev keeps the default ports; nothing else
binds the offset port ranges. If you start dev tooling that uses CI port
ranges directly, the broker can no longer guarantee freshness.
