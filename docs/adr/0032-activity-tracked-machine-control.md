# ADR-0032: Activity-tracked machine control (xTool laser)

**Status:** Accepted, but the **on-terminal HTTP-poll transport no longer works on
the real P2S** — its current firmware removed the port-8080 API and moved control
behind a TLS/WebSocket protocol on port 28900. The Laser Cutter is reverted to
`relay` (wall-clock) billing in the meantime. A **proven** software path to the
cutting signal exists via that new protocol, best implemented gateway-side; see the
2026-07-07 update at the end. The `xtool_p2s` firmware/cloud code path stays intact
and still works against any host exposing the port-8080 API (e.g. the host
simulator stub).

**Date:** 2026-07-05

## Context

Most machines are relay-controlled: the terminal energises a relay for the whole
session and bills the wall-clock session duration. The xTool P2S laser cutter is
different — it must stay powered for the whole session (homing, focusing,
material loading) but should only be **billed for the time a job is actually
cutting**, and a session left open on an idle laser should end itself rather than
run up charges.

The laser exposes a local HTTP API (`GET :8080/system?action=get_working_sta`,
`working` = `"0"` idle / `"1"`,`"2"` running). The `machine_control` module
already separates the actuator (`MachineToggle`), the running-sensor
(`MachineSensor`), and the coordinator (`MachineController`), but the only sensor
mirrored the relay, so `machine_running` never diverged from "powered".

Two decisions had to be made:
1. How to make the terminal report — and the cloud bill — only in-use time.
2. How to auto-end an idle session, and how to represent that in the FSM/UI.

## Decision

**Control type in config.** Add an `XToolP2sControl` arm to the `MachineControl`
proto `oneof` (`host`, `port`, `idle_timeout_sec`, `idle_warning_sec`,
`poll_interval_sec`), sourced from the Firestore `machine.control` map. The
firmware selects `XToolMachineSensor` (LAN HTTP polling) instead of the
toggle-mirroring `DefaultMachineSensor` for these machines; the relay is
unchanged.

**Poll on a dedicated thread.** The TCP calls are synchronous and can block (a
connect to an offline laser blocks for the connect timeout). The sensor runs its
poll loop on its own thread — never the shared async2 dispatcher — so an
unreachable laser can't freeze NFC auth, the UI, or session timeouts. The
`MachineController` in-use accumulator it feeds is mutex-guarded because it is now
written from the sensor thread and read from the dispatcher and UI render threads.

**Bill on reported active time.** The terminal accumulates in-use time and reports
it as `MachineUsage.active_seconds` (real check-in/out timestamps preserved). The
cloud (`handle_upload_usage.ts`) decides the billing basis from the machine's
Firestore control type — `activeSeconds` for `xtool_p2s`, `endTime - startTime`
otherwise — and freezes it as `billableSeconds` on each `usage_machine` doc, which
the accumulation logic sums. Legacy docs without `billableSeconds` fall back to
wall-clock.

**Idle auto-end with snooze.** A new `IdleWarning` FSM state (UI `kEndingSoon`),
driven by `SessionController`, ends the session with the existing
`CheckoutReason::kTimeout` after `idle_timeout_sec` of no cutting, showing a
countdown warning `idle_warning_sec` before with a "Weiter" snooze that grants
another full period. The terminal shows yellow while ready-but-idle and green only
while cutting.

## Consequences

**Pros:**
- Members are billed only for laser time, matching the workshop's charging model.
- Forgotten sessions self-close; no manual admin cleanup.
- Relay machines are completely unaffected (feature gated on control type).
- Preserving real timestamps keeps `usage_machine` auditable; the explicit
  `active_seconds`/`billableSeconds` fields make the billing basis inspectable.

**Cons:**
- A new per-machine dedicated thread (small, one per xtool terminal).
- Billing basis is driven by the Firestore control type, so a config/firmware
  rollout mismatch can zero-bill; mitigated by a warning log when an xtool machine
  reports 0 active seconds over a non-trivial session, and by rolling out functions
  before firmware (functions already tolerates a missing `active_seconds`).

**Tradeoffs:**
- *Compress `check_out` (firmware-only, no cloud change)* was rejected: it would
  make `usage_machine.endTime` a fiction (the billed window, not the real
  checkout), hurting auditability.
- *Proxy the HTTP poll through the Python gateway* was rejected: the P2 already has
  LAN networking (`ParticleTcpSocket`), and on-device polling avoids a gateway
  round-trip and keeps the laser dependency local to its own terminal.
- *Reuse `kStopPending` for the idle warning* was rejected: it carries
  `kUiCheckout` semantics and a fixed 3s window; a dedicated state keeps the
  `kTimeout` reason and configurable window clean.

## Update 2026-07-07 — the premise no longer holds on current P2S firmware

When we went to configure the real laser (`laser.internal` → `192.168.50.190`),
the port-8080 HTTP API this ADR depends on **was not there**. Findings from probing
the actual machine (it was online, powered, and cutting during the tests):

- **Port 8080 is refused** (nothing listening) — even while a job was actively
  cutting, so the API is not merely job-gated, it is gone.
- The laser exposes only **TCP 21 (FTP), 23 (Telnet), and 80** — and port 80
  accepts the socket but never returns an HTTP response to any request
  (`get_working_sta`, `/`, GET/POST, HTTP/1.0 and 1.1, with/without Host).
- No reply to the documented **UDP:20000 discovery** broadcast.
- A packet capture of xTool Creative Space driving the laser showed the real local
  channel is **TCP port 28900, TLS 1.2 encrypted** (proprietary app protocol; a
  small control stream plus a ~3.4 MB camera/preview download). No plaintext status
  endpoint exists anywhere.

The owner had confirmed the port-8080 API worked before the update, so an **xTool
firmware update removed the plaintext local API** and moved local control behind
TLS on 28900. This is **vendor-confirmed and intentional**: xTool's support notice
of 2026-03-16 (<https://support.xtool.com/article/3078>) announces a "security
protocol restructuring" and states that *"certain models, such as P2S, F1, F1 Lite,
and F1 Ultra, will experience restrictions with LightBurn connections after the
firmware upgrade."* — i.e. third-party local access was deliberately locked down,
not broken by accident, and will not return on its own. Reading "is cutting" now
would require a TLS client on the P2 plus reverse-engineering a proprietary,
encrypted protocol that the vendor is actively restricting — rejected as
high-effort and fragile.

**Interim decision:** the real `machine/…/control` was reverted to `relay` (seed,
prod Firestore, and the Particle `terminal-config` ledger for device
`0a10aced202194944a042eb0`), so the Laser Cutter bills wall-clock like every other
machine and does not falsely idle-out. The `xtool_p2s` firmware code path remains
intact and covered by tests/simulator.

**A software signal does still exist (proven on our hardware).** xTool's V2
transport, though encrypted, is fully reverse-engineered by the MIT-licensed
`thecodingdad/ha-xtool` Home Assistant integration. The live surface:

- **Transport:** three TLS WebSockets to `wss://<laser>:28900/websocket?id=<ms>&function=instruction|file_stream|media_stream` (self-signed cert, verification off).
- **Framing:** every payload wrapped in a `0xBABE` + 3-byte-len + type + CRC-16/ARC envelope (`protocol_type` 4 = JSON); raw TEXT frames are dropped.
- **Auth:** none — a guest `parity` first-message handshake (`/v1/user/parity`, `userID:"mk-guest"`, `userKey` = base64("makeblock-xtool")); 3 s heartbeat (`/v1/user/ping`, txn 65510).
- **State (P2S dialect):** `GET /v1/device/runningStatus` → `data.curMode`. Verified live: idle → `mode:"P_IDLE"`, job loaded → `{mode:"Work",subMode:"workReady"}`, **actively cutting → `{mode:"Work",subMode:"working"}`**. Push events `/device/status` (`WORK_PREPARED`/`WORK_STARTED`/`WORK_FINISHED`) and `/work/result` (`info.timeUse` = **job seconds**) give the same signal event-driven.

A ~120-line Python PoC (in the scratchpad, cribbed from ha-xtool) did the full
TLS→WS→envelope→parity→poll and read the laser flipping to `subMode:"working"`
during a real cut. So activity billing is achievable **without hardware**.

**Recommended path (supersedes the current-sensing idea):** implement the WS-V2
client **in Python on `maco_gateway`**, not on the P2 terminal. The gateway is
already Python, on the workshop LAN, and Firebase-connected; TLS/WebSocket/JSON are
trivial there and ha-xtool's proven code drops in, whereas porting TLS + WebSocket +
the CRC envelope + a JSON parser into the async2 P2 firmware is heavy and fragile.
This reverses the original ADR's "proxy the poll through the gateway → rejected"
tradeoff below, whose reasoning assumed a one-line plaintext HTTP poll. The gateway
observes `subMode`/`work-result` and feeds cutting-seconds into the usage/billing
model. **Residual risk:** still vendor-protocol-dependent, but this is xTool
Studio's *current* stable V2 protocol, far more durable than the removed 8080 API.
A follow-up ADR should capture the gateway-side design before implementation.
