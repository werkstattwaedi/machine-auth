# ADR-0002: Firmware Simulator Architecture with HAL Abstraction

**Status:** Accepted

**Date:** 2025-10-12

## Context

Developing embedded firmware has a slow iteration cycle:
1. Make code change
2. Compile firmware (60+ seconds with `neopo`)
3. Flash to hardware via USB
4. Test physically with NFC tags and terminal

This makes UI development painfully slow. We need faster iteration for LVGL UI layouts and state transitions.

## Decision

Create a **native desktop simulator** that compiles the UI layer separately, sharing only the UI code and state interfaces with the firmware.

### Architecture

```
Firmware (Particle):                 Simulator (Desktop):
┌──────────────────┐                 ┌──────────────────┐
│ UI (LVGL)        │◄────────────────┤ UI (LVGL)        │ (shared code)
├──────────────────┤                 ├──────────────────┤
│ state/           │◄────────────────┤ state/           │ (shared interfaces)
├──────────────────┤                 ├──────────────────┤
│ logic/           │                 │ MockApplication  │ (separate impl)
│ Application      │                 │                  │
├──────────────────┤                 ├──────────────────┤
│ drivers/         │                 │ hal/             │ (separate impl)
│ MacoHardware     │                 │ SimulatorHardware│
└──────────────────┘                 └──────────────────┘
   Particle APIs                        SDL2
```

**Key principle:** `state/` defines interfaces, `logic/` (firmware) and `simulator/mock/` (simulator) provide different implementations.

### What is Shared

- `ui/` - LVGL UI components (compile on both platforms)
- `state/` - State interfaces (`IApplicationState`, state variant types)
- `hal/` - Hardware interface (`IHardware` for LEDs/buzzer)

### What is Separate

**Firmware (`src/`):**
- `logic/Application` - Real session management, cloud communication, NFC
- `drivers/MacoHardware` - Particle NeoPixel APIs

**Simulator (`simulator/`):**
- `mock/MockApplication` - Fake state for UI testing (keyboard shortcuts to cycle states)
- `hal/SimulatorHardware` - SDL2 rendering for LED visualization
- `main.cpp` - SDL2 window, event loop

### Build

```bash
cd firmware/simulator
./build.sh
./build/simulator --state idle
```

## Consequences

### Pros

- **Fast iteration**: 2 seconds vs 2 minutes
- **Native debugging**: gdb/lldb with breakpoints
- **No hardware needed**: UI development without physical device

### Cons

- **Limited scope**: Only tests UI, not business logic
- **Mock drift**: Simulator state may diverge from real firmware behavior
- **Maintenance**: Keep `state/` interfaces stable across both builds

## Related

- Simulator build: `firmware/simulator/CMakeLists.txt`
- State interfaces: `firmware/src/state/iapplication_state.h`
- Simulator entry: `firmware/simulator/main.cpp`
