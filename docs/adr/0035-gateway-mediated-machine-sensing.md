# ADR-0035: Gateway-mediated machine sensing (leased poll)

**Status:** Accepted

**Date:** 2026-07-08

## Context

[ADR-0032](0032-activity-tracked-machine-control.md) bills the xTool laser on
*cutting* time by having the **terminal firmware** poll the laser's local HTTP API
(`GET :8080/system?action=get_working_sta`) on a dedicated thread. That premise
died: xTool's 2026-03 "security protocol restructuring" firmware
(<https://support.xtool.com/article/3078>) removed the plaintext port-8080 API and
moved local control behind a **proprietary, TLS-encrypted WebSocket protocol on
port 28900** (the "V2" protocol; also what broke LightBurn). See the 2026-07-07
update in ADR-0032 for the full investigation.

The cutting signal still exists and is reachable with **no authentication** — proven
end-to-end against our actual P2S with a ~120-line Python PoC that did
TLS → WebSocket → `0xBABE` CRC-16 envelope → guest `parity` handshake →
`GET /v1/device/runningStatus`, and watched `curMode.subMode` flip to `"working"`
during a real cut. The protocol is fully documented by the MIT-licensed
`thecodingdad/ha-xtool` integration.

But that transport (TLS + WebSocket + CRC framing + JSON-RPC + heartbeat) is a poor
fit for the P2 firmware: it would mean a client TLS socket, a WebSocket client, a
JSON parser, and the CRC envelope all in the async2 world — heavy, and *fragile*
(it just proved it breaks on vendor updates). Meanwhile the `maco_gateway` is
Python, already on the workshop LAN, and already runs long-lived async workers —
where TLS/WebSocket/JSON are free and the `ha-xtool` code drops in.

## Decision

Move the device-specific sensing **out of the firmware and into the gateway**, behind
a **generic "gateway sensing"** seam. The firmware stops knowing what an xTool is; it
asks the gateway "is machine X running?" and the gateway runs whatever protocol that
machine needs.

### Firmware — a generic sensor, no protocol knowledge

- New `GatewayMachineSensor : public MachineSensor`. It implements the existing
  one-method sensor interface and drives the existing `NotifyRunning(bool)` callback,
  so **`MachineController`, the `active_seconds` accumulator, usage upload, and all
  `SessionController`/`IdleWarning` logic are unchanged** (they key off
  `OnMachineRunning` / `MachineRunningSource`, not any sensor type).
- It runs **on the shared async2 dispatcher — no dedicated thread** (unlike
  `XToolMachineSensor`), because the gateway RPC read is the non-blocking `ReadTask`.
  It uses the `ValueProvider` + `RaceWithDeadline` bridge that
  `gateway_connection_check.cc` (the `Ping` coroutine) already models.
- `XToolMachineSensor` and its per-target `TcpSocket` / thread plumbing
  (`GetMachineSensorSocket`, `GetMachineSensorThreadOptions` in host + p2
  `system.cc`, the `xtool_machine_sensor` Bazel target) are **deleted**.
- Config: a generic `GatewaySensingControl { uint32 idle_timeout_sec; uint32
  idle_warning_sec; SensingSpec spec }` arm on the `MachineControl` oneof, where
  `SensingSpec` is a **typed oneof** (`XToolLaserControl{host,port,poll_interval_sec}`
  / `MockSensingControl`) — the backend is chosen by the set oneof arm, not a
  stringly-typed `kind`. The idle timings stay firmware-side (they drive
  `SetIdleTimeout`); `spec` is **opaque passthrough** the firmware forwards to the
  gateway without interpreting.

### Terminal ↔ gateway — leased unary poll (not push)

Both sides are unary-only today, and the gateway is a *hand-rolled* pw_rpc packet
router with no streaming path. Server-streaming "subscribe to events" was rejected
(see Alternatives). Instead the terminal **leases** a sensing session and polls it —
the lease gives the gateway an explicit, self-expiring signal of "a terminal still
cares," so it knows exactly how long to keep the laser connection open.

Two new unary methods on `maco.gateway.GatewayService`:

```proto
// Start (or reuse) a sensing session for a machine; returns a lease + current state.
rpc AcquireSensingLease(AcquireSensingLeaseRequest) returns (SensingLeaseResponse);
message SensingSpec {                         // typed oneof, mirrors device_config
  oneof backend {
    XToolLaserControl xtool_laser = 1;
    MockSensingControl mock = 2;
  }
}
message XToolLaserControl { string host = 1; uint32 port = 2; uint32 poll_interval_sec = 3; }
message AcquireSensingLeaseRequest {
  SensingSpec spec = 1;
  uint32 lease_ttl_sec = 2;     // e.g. 60 — how long the lease survives without renewal
}

// Renew the lease and read current state; this is the poll.
rpc RenewSensingLease(RenewSensingLeaseRequest) returns (SensingLeaseResponse);
message RenewSensingLeaseRequest { string lease_id = 1; }

message SensingLeaseResponse {
  string lease_id = 1;          // empty if invalid/expired -> caller re-acquires
  bool valid = 2;
  SensingState state = 3;       // UNSPECIFIED / UNREACHABLE / IDLE / RUNNING
}
```

State is an **enum**, not two bools — the ambiguous "running-but-unreachable" combo
can't be expressed; on losing the device the gateway returns `UNREACHABLE` (never a
stale `RUNNING`). The firmware maps `RUNNING → NotifyRunning(true)`, else `false`.
No `machine_id` field — leases are keyed by `lease_id`, probers by `(backend, host)`.

Both slot into the existing hand-rolled dispatcher next to `Forward`/`Ping`
(method-id hash + handler); the handlers are plain in-memory reads/writes, so they
stay off the network path.

**Terminal loop** (in `GatewayMachineSensor`, **session-scoped** — it only leases and
polls while a session is active, wired via the existing `SessionObserver`, so the
gateway holds the device connection open only during real use, not 24/7).
`lease_ttl_sec` ≫ `poll_interval_sec` (60 s vs 3 s) so a few dropped polls never
expire the lease:

1. On session start: `AcquireSensingLease(spec, ttl=60)` → store `lease_id`,
   `NotifyRunning(state == RUNNING)`.
2. Every `poll_interval_sec`: `RenewSensingLease(lease_id)`.
   - `valid` → `NotifyRunning(state == RUNNING)`.
   - `!valid` or RPC error/timeout → `NotifyRunning(false)` (preserves
     "unreachable ⇒ idle ⇒ auto-end") and re-`Acquire` on the next tick.
3. On session end: stop polling and let the lease lapse — the gateway drops the
   device connection after the TTL.

### Gateway — lease registry + async probers

- A `SensingLeaseRegistry`: `lease_id → (spec, expiry)`. `Renew` extends `expiry`;
  a reaper sweeps expired leases every few seconds.
- A `ProberRegistry` keyed by `(backend, host)`, ref-counted by the live leases that
  reference it. A prober is an **async** backend task (the PoC ported from sync to
  `asyncio`, with a hand-rolled WebSocket client over an `asyncio` TLS stream — no new
  pip dep) that holds the TLS WS-V2 session, does the parity handshake + 3 s heartbeat,
  tracks state in memory, and is torn down when its last lease expires — so **the laser
  WS is open only while a terminal is actively leasing.** A reaper coroutine is gathered
  in `serve()` alongside `PrintWorker`.
- The `SensingSpec` oneof arm selects the backend class, so a future machine type is a
  **gateway-only** change plus a Firestore config value — zero firmware churn.

**P2S backend (`xtool_laser`), verified on hardware:**
`wss://<host>:28900/websocket?id=<ms>&function=instruction` (self-signed cert,
verification off) → `0xBABE` + 3-byte-len + type(4=JSON) + payload-CRC + header-CRC
envelope → parity handshake (`/v1/user/parity`, `userID:"mk-guest"`,
`userKey`=base64(`makeblock-xtool`)) → 3 s heartbeat (`/v1/user/ping`, txn 65510) →
poll `GET /v1/device/runningStatus`. `running` ≙ `data.curMode.subMode == "working"`
(`"workReady"` = loaded-not-started; idle reads `"P_IDLE"`). The push events
`/device/status` (`WORK_STARTED`/`WORK_FINISHED`) and `/work/result`
(`info.timeUse` = job seconds) give the same signal event-driven if we later prefer
that over polling.

### Firestore / config shape

`machine.control` becomes, e.g.:

```jsonc
"control": {
  "type": "gateway_sensing",
  "kind": "xtool_laser",
  "host": "laser.internal",
  "pollIntervalSec": 3,      // optional
  "idleTimeoutSec": 900,     // firmware-side
  "idleWarningSec": 120      // firmware-side
}
// (lease TTL is a firmware constant — kLeaseTtlSec = 60s — not a config field.)
```

`scripts/sync-device-config.ts` `buildControl` maps this to the
`GatewaySensingControl` proto arm (idle timings top-level; `kind`/`host`/`port`/
`pollIntervalSec` → `spec`). The cloud billing basis in `handle_upload_usage.ts`
stays keyed on activity (`activeSeconds`) for sensed machines.

## Consequences

**Pros:**
- The fragile, vendor-specific protocol lives in Python where it's cheap to write
  and cheap to fix; the firmware never changes when xTool revs their protocol again.
- The firmware seam is generic — new machine types are gateway + config only.
- Billing, idle-timeout, session FSM, and the whole cloud path are untouched.
- The lease makes the gateway↔laser connection lifecycle explicit and self-healing:
  terminal crash → lease lapses → WS dropped; gateway restart → renew invalid →
  terminal re-acquires. The laser WS is open only while actually needed.

**Cons / tradeoffs:**
- Sensing now depends on the gateway being up and on the LAN (previously terminal-
  local). A gateway outage zeroes billing and idles sessions out — same failure mode
  as an unreachable laser, and mitigated the same way (unreachable ⇒ idle).
- Two new unary RPCs + a new async subsystem in the gateway (lease registry, prober
  registry, WS-V2 backend). No new pip dependency — the WebSocket client is hand-rolled
  over an `asyncio` TLS stream.
- Still vendor-protocol-dependent — but this is xTool Studio's *current, stable* V2
  protocol, far more durable than the removed 8080 API, and now isolated to one
  Python module.

**Rejected alternatives:**
- *Server-streaming push (terminal subscribes)* — rejected for v1: the gateway's
  hand-rolled router has no streaming path (would need `SERVER_STREAM` emission +
  a `device_id→connection` index), and the firmware has no client-side streaming
  reader to copy (custom re-arming future). The terminal↔gateway hop is local and
  cheap, so polling it costs almost nothing; the expensive laser polling is offloaded
  either way. Revisit only if idle-detection latency ever matters.
- *Gateway reads `machine.control` from Firestore itself* — rejected: adds a second
  config path and requires Firestore credentials on every sensing gateway. Leased
  terminal-forwarded config keeps the ledger as the single source and the gateway a
  stateless executor.
- *Reimplement TLS/WS-V2 on the P2 firmware* — rejected: heavy embedded TLS +
  WebSocket + JSON + CRC, and re-couples the firmware to a protocol that breaks on
  vendor updates.
- *Out-of-band current sensing* (ADR-0032's earlier fallback) — unnecessary now that
  a proven software signal exists; kept as a hardware option only if xTool later
  locks down the LAN API entirely.

## Implementation notes

- **Session-scoped leasing** is in v1: the `GatewayMachineSensor` implements
  `SessionObserver` and leases/polls only while a session is active, so the gateway
  holds the laser WS open only during real use.
- **Live laser test is deferred to on-site** (needs physical access): `maco_gateway`
  ships a `probe_laser` runner (`tools/probe_laser.py`) that drives the `xtool_laser`
  backend directly against the laser and prints its live `SensingState`. Everything
  else — the WS-V2 framing, the full session→RUNNING/IDLE/UNREACHABLE flow (against a
  fake WS server), the lease/prober registries, and the firmware sensor (against a mock
  gateway) — is unit-tested and runs without the laser.
- **Mock backend** (`MockSensingControl`) provides scriptable state for the host
  simulator and tests, so the gateway-sensing path is exercisable without a real device.
- No new pip dependency: the WS-V2 client is a hand-rolled WebSocket over an `asyncio`
  TLS stream (the framing we need is small), keeping the gateway's Bazel pip set
  unchanged.
