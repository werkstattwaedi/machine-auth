# ADR-0032: Activity-tracked machine control (xTool laser)

**Status:** Accepted

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
