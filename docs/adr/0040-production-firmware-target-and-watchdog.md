# ADR-0040: Production firmware target and hardware watchdog

**Status:** Accepted

**Date:** 2026-07-19

## Context

Terminals in the field run `//maco_firmware/apps/dev` — the development
firmware. Two consequences are unacceptable for an unattended production
workshop terminal:

1. **Every boot blocks up to 10 s.** `apps/dev/main.cc:157` calls
   `maco::system::WaitForUsbSerial()` (`targets/p2/system.cc:125-142`), which
   busy-polls `HAL_USB_USART_Is_Connected` for up to 10 s so a developer with a
   console attached sees early logs. In production nobody is attached — it is
   pure dead time on every power-on.
2. **A hung terminal never recovers.** There is no watchdog anywhere in the
   firmware (only a *read* of the watchdog reset reason). If the pw_system
   dispatcher — which drives `SessionFsm`, `MachineController` (the relay),
   `TagVerifier`, and every session timeout — wedges, the terminal is dead until
   someone power-cycles it. A `PW_CHECK` failure calls
   `HAL_Core_Enter_Safe_Mode` (`third_party/particle/pw_assert_particle/handler.cc:58`),
   which halts the app indefinitely rather than rebooting.

`apps/prod/BUILD.bazel` exists only as a commented-out stub. This ADR defines
the production build flavor and adds a watchdog so a wedged terminal
self-recovers.

Key enabling discovery: a hardware-watchdog wrapper already exists in-tree and
unused — `pb::watchdog::Watchdog` (`third_party/particle/pb_watchdog/`) wraps
the DeviceOS `hal_watchdog_*` IWDG API in Pigweed style (`pw::Status`,
`pw::chrono`), `target_compatible_with` cortex-m33. The watchdog work is
therefore *where to feed it*, not *how to call the HAL*.

## Decision

### 1. `:prod` as a runtime-configured flavor of the same app

Dev and prod are the **same application** differing only in boot policy, so we
do not fork the 330-line `apps/dev/main.cc`. Instead:

- Extract today's `apps/dev/main.cc` body (`AppInit`, `RecoverOrphanedSession`,
  all module wiring) into a shared `//maco_firmware/apps/app_main` library
  exposing `void RunApp(const AppConfig&)`. `DEV_DEPS` moves here.
- `AppConfig` is a plain struct: `wait_for_usb_serial` (dev: true, prod: false),
  `enable_watchdog` (prod: true), `watchdog_timeout`.
- `apps/dev/main.cc` and `apps/prod/main.cc` become thin shims passing their
  config into `RunApp`. `WaitForUsbSerial()` becomes
  `if (cfg.wait_for_usb_serial) …`.

Boot policy is a **runtime bool, not `#ifdef MACO_PROD` or `select()`** — the
shared library compiles once, stays host-unit-testable, and avoids a
preprocessor fork of the largest file in the firmware. (The repo's only
`config_setting` gates hardware-vs-host, not app policy.)

- **Optimization:** a `build:prod` `.bazelrc` config carrying `-c opt`.
  `PW_CHECK` stays active (`-c opt`/`NDEBUG` does not strip pw_assert `PW_CHECK`,
  by design — only `PW_DASSERT` is debug-gated). That is the desired safety
  behavior.
- **Logging: keep `PW_LOG_LEVEL_INFO`.** P2 uses tokenized logging over pw_rpc
  (4-byte token on the wire); the field-debug value via `./pw console` far
  exceeds the negligible cost. Raising the level is also mechanically awkward
  (the level is a global `.bazelrc` define baked into every prebuilt module lib,
  not reachable via per-target `copts`) and would fragment the token database.
- **Keep the RPC/diagnostic services** (`MacoService`, `MetricService`,
  `StackMonitor`) — they are the terminal's only remote-debug channel. Drop
  `StackMonitor` first only if a future memory budget forces cuts.
- **`./pw`:** add `prod-flash` and `prod-console` subcommands mirroring the
  existing `personalize-flash` / `console` cases.

### 2. Hardware IWDG watchdog, fed from a supervised dispatcher heartbeat

Use the hardware IWDG through the existing `pb::watchdog::Watchdog`. (DeviceOS
`ApplicationWatchdog` is a Wiring class explicitly excluded from this project's
build and is only a software-thread timer anyway; there is no `pw_watchdog`.)

The liveness signal must be the **pw_system async dispatcher**, because that is
what runs the safety-relevant logic. Feeding from a standalone timer thread is
explicitly rejected: it would keep petting the dog while the dispatcher is
wedged — the exact "busy but hung" case we must catch.

Design — supervised feed:

1. A periodic task **on the dispatcher** increments an
   `std::atomic<uint32_t> heartbeat` every ~1 s (proves the critical loop is
   scheduling work).
2. A dedicated critical-priority feeder thread wakes every ~2 s and calls
   `wdt.Feed()` **only if** the heartbeat advanced since it last looked. Stale
   heartbeat → no feed → IWDG expires → reset.

- **Timeout: 8 s** (heartbeat ~1 s, feeder ~2 s). Gateway RPC awaits are async
  `co_await`s that **yield** — a slow cloud round-trip does not block the
  dispatcher, so the heartbeat keeps ticking through it and does not need to be
  covered by the timeout (the earlier 30 s figure wrongly assumed it did). The
  timeout only has to clear the worst-case *legitimate* dispatcher stall (brief
  synchronous flash writes) plus a feeder period, so a genuine wedge is caught in
  seconds. Tunable via `AppConfig::watchdog_timeout` in `apps/prod/main.cc`.
- **Arm only after `AppInit()` completes** — boot includes display/NFC init and
  a gateway connect with a 10 s timeout; an early tight watchdog would reset
  mid-boot.
- Fix the pre-existing vexing-parse bug in `watchdog_hal.cpp` (`WatchdogLock
  lk();` declares a function, so the mutex is never taken) in the same PR, since
  we will exercise this code for real.

The reset path already works: an IWDG expiry sets the RTL reset flags →
`GetResetReason()` returns `kWatchdog` → `RecoverOrphanedSession()` already
treats `kWatchdog` as involuntary and resumes the session iff the latching relay
is still on. **No recovery-side code changes needed.**

### 3. Prod assert handler resets instead of halting

The prod build's `PW_CHECK` failure handler logs the tokenized
file/line/message and then calls `HAL_Core_System_Reset()`, so an unattended
terminal self-recovers immediately instead of dropping into DeviceOS safe mode
(recovery mode) and waiting for a human. Dev keeps the safe-mode handler so a
developer can inspect the halted state.

Mechanism: the `particle_firmware` rule previously hardcoded
`@particle_bazel//pw_assert_particle:handler` (the safe-mode handler) with
`alwayslink = True`, so it was force-linked into every firmware. Added a
backward-compatible `assert_handler` parameter to `particle_cc_binary` /
`particle_firmware` (default = the safe-mode handler, so dev/factory/personalize
are unchanged). `apps/prod` passes
`//maco_firmware/targets/p2:assert_handler`, a `select()` that resolves to the
reset handler under `--config=prod` and the safe-mode handler otherwise. The
platform's `pw_assert_basic:handler_backend` flag points at the same `select()`
target, so both the rule dep and the flag resolve to one handler (deduped) with
no `pw_assert_basic_HandleFailure` collision. Verified on-device: `Crash` RPC
previously dropped to recovery mode; now it resets.

### 4. Required companion — rapid-reset guard (ships *with* the watchdog)

A watchdog turns a *deterministic* boot-time failure (e.g. a failing
`PW_CHECK_OK(machine_toggle.Init())`) into a reset **boot-loop**. Before arming
any watchdog, add a rapid-reset counter in backup RAM (the `BKUP_*` registers,
same mechanism the reset-reason already uses): if N resets occur within M
seconds, fall through to a **minimal safe state** — relay forced OFF, watchdog
disarmed, error screen — instead of re-arming. This is not optional; it is the
guard against bricking a terminal on a deterministic fault.

### 5. Relay safety — no new code

The machine relay is latching (`LatchingMachineRelay`): a watchdog reset does
not de-energize it, but `MachineController` boots with `pending_ = kDisable` and
cuts power on its first poll unless `RecoverOrphanedSession` legitimately
resumes an authorized session. This is the existing ADR-0032 fail-safe; a
watchdog reset is indistinguishable from the already-handled power-loss/panic
case. Verify on-device, but no code change is required.

## Consequences

- Production terminals boot without the 10 s serial wait and self-recover from a
  wedged dispatcher, a `PW_CHECK` fault, or a hard hang.
- **Assert behavior differs in prod:** a `PW_CHECK` failure resets the terminal
  directly (§3), and a genuine dispatcher wedge is caught by the watchdog in ~8 s;
  dev keeps safe mode and has no watchdog. Any runbook expecting a prod terminal
  to *stay* halted for inspection no longer holds.
- Two firmware apps to maintain, but the shared `RunApp` library keeps the delta
  to a small config struct.
- New required on-device test pass before rollout (see below); this cannot be
  validated on host or in CI.

## Risks

- **Deterministic boot fault → reset loop.** Mitigated by the §4 rapid-reset
  guard, which must ship together with the watchdog.
- **OTA / DFU while the watchdog is armed** is the single most likely way to
  brick a fleet remotely — an independent IWDG could reset the device mid-flash.
  Validate an OTA with the watchdog armed, and stop feeding / `Disable()` around
  update events if needed, *before* broad rollout.
- **Watchdog armed too early / too tight** resets mid-boot — mitigated by arming
  after `AppInit` (the 8 s timeout starts only once init is complete).

## Alternatives considered

- **DeviceOS `ApplicationWatchdog`** — rejected: it's a Wiring class excluded
  from this build, and only a software-thread timer (no better than a naive
  feed).
- **Naive timer-thread feed** — rejected: pets the dog even while the dispatcher
  is wedged, defeating the purpose.
- **`#ifdef MACO_PROD` / `select()` fork of `main.cc`** — rejected: forks the
  largest file, loses host-unit-testability, gains nothing over a runtime bool.
- **Raising prod log level to WARN** — rejected: tokenized logs are nearly free
  and are the primary field-diagnostic surface; the change is mechanically
  awkward and fragments the token database.

## Implementation plan

1. **Done.** Extract `//maco_firmware/apps/app_main` (`RunApp(AppConfig)`); reduce
   `apps/dev/main.cc` to a shim. Behavior-preserving.
2. **Done.** Add `apps/prod` target + `build:prod` config (`-c opt`) +
   `./pw prod-flash`/`prod-console`; prod in `./pw build p2`.
3. **Done.** Rapid-reset guard — persisted in **EEPROM** (`HAL_EEPROM_Get/Put`,
   a littlefs-backed file that survives watchdog/panic/power cycle), not backup
   registers (those are not linkable from this split user-part build). Exposed as
   `system::RecordBoot` / `ScheduleBootStableClear`; `app_main` falls to a
   safe state (no session resume, no watchdog) past `kMaxConsecutiveBoots`.
4. **Done.** Supervised watchdog feed via `system::StartWatchdog` (P2:
   `pb::watchdog::Watchdog` + dispatcher-heartbeat coroutine + priority-8 feeder
   thread; host no-op). Boot logs the reset reason. The `WatchdogLock`
   vexing-parse bug was **not** fixed — it lives in the prebuilt Device OS system
   part (not the user build), and a single-threaded feeder doesn't need the lock.
5. **Done.** Prod assert handler resets instead of dropping to safe mode, via a
   backward-compatible `assert_handler` parameter on `particle_cc_binary` /
   `particle_firmware` plus a `--config=prod` `select()`. Verified on-device.
6. **On-device test pass (below) — owner: maintainer**, before flashing the fleet.

## Code-review follow-ups (not yet addressed)

A review of the implementation (against ADR-0016 and the boot path) surfaced
these; the safety-relevant storage/availability ones (EEPROM→KVS deadlock,
watchdog disarm on boot-loop, orphan-session close-and-store, feeder stack) were
fixed in the implementation commits. These remain open:

- **Early `PW_CHECK_OK(machine_toggle.Init())` bypasses the rapid-reset guard.**
  It runs unconditionally near the top of `AppInit`, *before* the `boot_loop`
  branch and before `MachineController` (which drives the relay OFF) exists. So
  the guard's own headline example — a deterministic `machine_toggle.Init()`
  failure — hard-crashes every boot and never reaches the safe state, leaving the
  latching relay in an undefined (possibly ON) state. Pre-existing behavior, but
  ADR-0040 makes involuntary resets the normal recovery path, so it now matters.
  Fix: degrade gracefully like display-init already does (log + force relay OFF +
  minimal error state, skip watchdog) instead of `PW_CHECK`. Needs on-device
  validation of what an `Init()` failure means for relay controllability.
- **No user-visible safe-state indication.** `boot_loop` only logs; a person in
  front of a boot-looping terminal sees the normal UI. Add a degraded-mode screen
  (or consciously accept log-only).
- **`RecoverOrphanedSession` resume-branch fall-through** (pre-existing): when the
  reset was watchdog/panic with the relay on but `LoadOrphanedSession()` fails,
  execution falls to `return false` without storing a usage record or clearing
  the active session, so `HasOrphanedSession()` stays true next boot. Now reachable
  because watchdog resets are the normal recovery path. Fix: close+clear in that
  fall-through too.

## On-device verification (real hardware; done by the maintainer)

- **Watchdog trips on a real hang:** a test-only RPC that spins the dispatcher
  forever → logs stop, device reboots in ~8 s, `GetResetReason() == kWatchdog`
  (or query `GetDeviceInfo().reset_reason == 1`).
  Confirm the *naive-timer* design would NOT reboot (why it's rejected) and the
  supervised design does.
- **Boot is fast:** time power-on → "AppInit complete"; prod should be markedly
  faster than dev's up-to-10 s.
- **Reset-reason + recovery:** trigger RESET pin (`kPowerCycle`), a `PW_CHECK`
  fail (prod: `kPanic`/reset), and a watchdog hang (`kWatchdog`); confirm
  `RecoverOrphanedSession` resumes only on watchdog/panic with the relay on and
  de-energizes otherwise, on a real latched relay.
- **Rapid-reset guard:** force a deterministic boot fault; confirm it drops to
  the minimal safe state (relay OFF) instead of looping forever.
- **OTA with watchdog armed:** confirm an OTA completes without a watchdog reset.
