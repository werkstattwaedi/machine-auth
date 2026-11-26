# ADR-0054: Gateway-mediated power control (Shelly)

**Status:** Proposed

**Date:** 2026-11-26

## Context

The CNC mill is the second machine whose terminal can't use the hardware as
intended: the switch box with the terminal's latching relay isn't finished, so
the mill is powered through off-the-shelf Shelly devices instead:

- **Shelly 1PM Gen4** on the computer + gantry feed — the switch we control.
  Switching it on boots the mill's controller; switching it off loses the homing.
- **Shelly EM Mini Gen4** on the spindle's own feed, which stays always on —
  meters only, so the spindle's draw is measured instead of guessed from a
  combined reading (whole machine: ~70 W idle, ~100 W gantry moving fast,
  >200 W spindle running).

Billing follows the laser's model ([ADR-0032](0032-activity-tracked-machine-control.md)):
the session powers the machine, but only use is charged — here, while the
spindle draws power. An idle session ends itself after 30 min, warning from
5 min before.

[ADR-0035](0035-gateway-mediated-machine-sensing.md) already moved device
protocols to the gateway, but only for *sensing*: the laser is switched by the
terminal's relay, and the lease reports one bit (`RUNNING`). Here the network
device is the switch, the machine has two signals with different jobs, and
"switch off" is expensive. Shellies are cheap, locally documented (Gen2+
JSON-RPC over HTTP, digest auth, no cloud needed) and likely to come back for
other machines, so the adapter should be generic, not mill-specific.

## Decision

### 1. All Shelly traffic goes through the gateway

The terminal never talks to a Shelly. The P2 keeps its one long-lived,
retried connection to the gateway; a per-device HTTP client, digest auth and
JSON parsing in the firmware would add connections on the Wi-Fi stack that has
been the least reliable part of the terminal, and would tie the firmware to a
vendor API. The gateway (Python, `httpx` already a dependency, `DigestAuth`
covers Shelly's SHA-256 digest) also keeps seeing the devices when the terminal
doesn't — which §4 relies on.

### 2. One generic Shelly client, composed by config

The gateway gets a `ShellyDevice(host, password)` client that reads a
component's status (`Shelly.GetStatus` → `switch:N.apower`, or the EM Mini's
meter component — the exact name is checked on the hardware) and sets a switch
output (`Switch.Set`). A machine combines devices in its `machine.control`:

```jsonc
"control": {
  "type": "gateway_sensing",
  "kind": "power",
  "actuator": { "host": "cnc-gantry.internal", "component": "switch:0" },
  "signals": [
    { "host": "cnc-spindle.internal", "component": "pm1:0",
      "role": "billable", "thresholdW": 40, "riseSec": 3, "fallSec": 10 },
    { "host": "cnc-gantry.internal",  "component": "switch:0",
      "role": "activity", "thresholdW": 85, "riseSec": 2, "fallSec": 10 }
  ],
  "pollIntervalSec": 2,
  "idleTimeoutSec": 1800,
  "idleWarningSec": 300,
  "idleWarningRepeatSec": 60,
  "endHoldSec": 3
}
```

The thresholds above are placeholders: the 70/100/200 W figures measured the
whole machine on one plug and no longer apply to the split feeds. A
`tools/probe_power.py` (sibling of `probe_laser.py`) prints both devices' live
readings so the values are set from a few real jobs. A signal counts as on
after `riseSec` above its threshold and as off after `fallSec` below it, so
power-on inrush isn't billed and a short spindle stop between toolpaths doesn't
flicker billing.

The Shelly password is one gateway secret (`SHELLY_PASSWORD`, operations repo),
never in `machine.control` — that config travels to the terminal and the
Particle ledger. Shellies live on a network the Pi reaches, without internet
access, with Shelly cloud off and auth on.

### 3. Two signal roles, two bits on the lease

`SensingLeaseResponse` gains `bool active` next to `state`:

- **billable** — `state = RUNNING`; drives `NotifyRunning` and therefore
  `active_seconds`, exactly as for the laser. Here: the spindle signal.
- **activity** — `active = true`; resets the idle timer. True when *any*
  signal is on (billable included — the gantry may stand still during a long
  cut, and that must not count as idle).

For the xTool backend `active == (state == RUNNING)`, so the laser behaves as
today. The cloud billing basis is unchanged: `gateway_sensing` already bills
`activeSeconds`.

### 4. Switching through the gateway, and what happens when it fails

A new unary `SetPower(actuator, on) → {on, reachable}` on `GatewayService`,
idempotent, and a firmware `GatewayMachineToggle : MachineToggle` that calls it
from `Enable`/`Disable`. The terminal uses it instead of the relay whenever
`actuator` is set. Failure behaviour, chosen because a wrong "off" costs the
homing while a wrong "on" costs access control and billing:

- **Switch-on fails** → the session doesn't start; the terminal says it has no
  connection to the machine (like MAC-9) and the machine stays off.
- **Switch-off fails** → the session ends anyway (billing stops); the terminal
  retries `SetPower(off)` and the gateway's backstop below catches the rest.
- **Device unreachable during a session** → `UNREACHABLE` *pauses* the idle
  timer instead of counting as idle (unlike the laser): the terminal couldn't
  switch it off anyway, and a Wi-Fi blip must not end a job.
- **Terminal gone** (lease lapses while the actuator is on) → the gateway does
  not switch off at once (a gateway or terminal restart would cost the homing).
  It logs an alert-matched event and applies the machine's own idle rule
  itself: once all signals have been off for `idleTimeoutSec`, it switches the
  actuator off. That bounds unauthorised and unbilled use to an idle machine.

### 5. Warning cadence and deliberate ending

Both firmware-side, per machine, and generic (not mill-specific):

- **`idleWarningRepeatSec`** — during the idle warning, the buzzer sounds when
  it starts and again every N seconds (mill: from 5 min before, every minute).
  Unset keeps today's silent single warning.
- **`endHoldSec`** — the stop button must be held this long (the ring fills
  while held) instead of today's 3 s auto-confirm. While the billable signal is
  on, ending from the button is refused with a message ("Spindel läuft").
  Unset keeps today's behaviour.

The rules these add or change go into `docs/spec/machine.md`; the branch that
implements this starts with the as-is rules for idle auto-end and billing on
active time, which the spec doesn't cover yet.

## Consequences

**Pros:**
- A new Shelly-powered machine is config only: hosts, components, roles,
  thresholds.
- The firmware stays vendor-agnostic; Shelly API changes are a Python fix.
- Billing on the spindle's own meter is a measurement, not a guess from a
  combined reading.
- The gateway backstop bounds what a crashed terminal can leave switched on.

**Cons:**
- The machine's power now depends on the gateway and the Wi-Fi to two
  Shellies: with the gateway down, no session can start.
- A third wire RPC (`SetPower`) and actuation state in the gateway; the
  backstop is a second place where the idle rule lives, and its timeout must
  come with the lease (the gateway stays stateless about machines otherwise).
- Off-the-shelf mains switching instead of the planned switch box — the 1PM
  Gen4 is rated 16 A and only switches the gantry/computer feed, so the
  spindle's ~1.8 kW never runs through a controlled relay.

**Tradeoffs:**
- *Terminal talks to the Shellies directly* — rejected: more connections on the
  P2's Wi-Fi, HTTP + digest + JSON in the firmware, and nobody watches the
  devices when the terminal is down.
- *Tuya plug (Hombli HBSS 3109)* — rejected: local access needs a key pulled
  from the vendor cloud that re-pairing or firmware updates can rotate.
- *myStrom WiFi Switch* — rejected: continuous load limited to 1800 W, and its
  local API has no authentication.
- *Lease lapse switches off immediately* — rejected: every gateway or terminal
  restart would cost the homing.
- *Single power threshold on one combined plug* — rejected now that the spindle
  is metered separately: the gantry-moving vs. spindle gap was too narrow to
  bill reliably.
