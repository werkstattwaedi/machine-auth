# Legacy Particle Firmware - AI Context

This document covers the legacy Particle-based firmware in `firmware/`. For the new Pigweed-based firmware, see `maco_firmware/CLAUDE.md`.

## Compilation

**CRITICAL: Always use the build scripts documented in [`docs/compile.md`](../docs/compile.md). Never run `cmake`, `make`, or `neopo` directly.**

```bash
# Compile Particle firmware (from anywhere)
firmware/neopo.sh compile

# Build and run simulator (from anywhere)
firmware/simulator/run.sh --state idle

# Or just compile simulator
firmware/simulator/build.sh
```

## Hardware Configuration

The system runs on Particle Photon 2 hardware with custom PCB.

**Key Components:**
- **NFC Reader**: PN532 via Serial1 (UART)
- **NFC Tags**: NTAG424 DNA with AES-128 mutual authentication
- **Display**: 240x320 SPI display (ILI9341 compatible)
- **Touch**: Capacitive touch controller
- **LEDs**: 16x WS2812 RGB LED ring
- **Relay**: Controls machine power via pin A1
- **Buzzer**: PWM buzzer on pin A2

**Pin Configuration:** See `firmware/src/config.h` for complete pin assignments.

**Factory Data:**
Device-specific keys stored in EEPROM at address 0:
```cpp
struct FactoryData {
  uint8_t version;        // EEPROM schema version
  byte key[16];           // AES-128 terminal key
  boolean setup_complete; // Setup mode flag
};
```

## Particle IoT API Usage Patterns

**Preference Hierarchy:**
1. C++17 std library functions (first choice)
2. Particle Wiring API (when std library insufficient)
3. Device OS API (for hardware/cloud features)

**Type Preferences:**
- `std::string` (preferred) over `String` (convert at API boundaries only)
- `std::array` over C-style arrays
- `std::chrono::time_point`, `std::chrono::seconds` over `millis()`, `system_tick_t`
- Fixed-width types: `uint8_t`, `int16_t`, etc. over `int`, `long`

**CRITICAL - Timing Functions:**
- `timeSinceBoot()` from `common/time.h` - returns monotonic time since device boot
- `timeUtc()` from `common/time.h` - returns current UTC time
- **NEVER use `std::chrono::steady_clock::now()`** - not available in Particle Device OS
- **NEVER use `std::chrono::system_clock::now()`** - use `timeUtc()` instead

## Cloud Communication

All cloud communication uses the Particle Cloud publish/subscribe mechanism with webhook integration to Firebase Functions.

**Request Flow:**
1. Firmware publishes to `terminalRequest` event with JSON payload
2. Particle webhook forwards to Firebase Function endpoint
3. Firebase Function processes and publishes response
4. Firmware subscribes to `{deviceId}/hook-response/terminalRequest/` for responses

**CloudRequest Template Pattern:**

```cpp
template<typename RequestType, typename ResponseType>
std::shared_ptr<CloudResponse<ResponseType>> SendTerminalRequest(
    String command,
    const RequestType& request,
    system_tick_t timeout_ms = CONCURRENT_WAIT_FOREVER
);

auto response = cloud_request_.SendTerminalRequest<
    fbs::StartSessionRequestT,
    fbs::StartSessionResponseT>("startSession", request);

if (state::IsPending(*response)) {
    return;  // Not ready yet
}

auto result = std::get_if<fbs::StartSessionResponseT>(response);
```

## Architecture Patterns

### State Management

Custom variant-based state machine template (`state/state_machine.h`):

```cpp
// Define states in state/ directory
namespace oww::state::machine {
struct Idle {};
struct Active {
  std::shared_ptr<TokenSession> session;
  std::chrono::time_point<std::chrono::system_clock> start_time;
};
}

using MachineStateMachine = StateMachine<machine::Idle, machine::Active>;

auto state_machine_ = MachineStateMachine::Create(std::in_place_type<machine::Idle>);
state_machine_->OnLoop<machine::Active>([this](auto& state) { return OnActive(state); });
state_machine_->TransitionTo(machine::Active{.session = session, .start_time = now});
```

**Key State Machines:**
- `NfcStateMachine` (`nfc/states.h`): WaitForTag → TagPresent → Ntag424Authenticated
- `MachineStateMachine` (`state/machine_state.h`): Idle ⇄ Active / Denied
- `SessionCreationStateMachine` (`state/session_creation.h`): Begin → ... → Succeeded/Rejected/Failed

### Error Handling

**tl::expected Pattern:**
```cpp
tl::expected<void, ErrorType> CheckIn();

auto result = machine_usage_.CheckIn(token_session);
if (!result) {
    return result.error();
}
```

### Threading Model

- **Main thread**: Application logic, state machines
- **NFC thread** (`nfc/nfc_tags.cpp`): Dedicated NFC polling loop
- **UI thread** (`ui/platform/maco_ui.cpp`): LVGL display updates
- **LED thread** (`ui/platform/maco_ui.cpp`): LED rendering

**Thread Safety:**
- Use mutexes for shared state (`WITH_LOCK()` macro)
- **NEVER use static local variables** across threads without mutex protection

## Module Organization

```
firmware/src/
├── common/              # Shared utilities
├── state/               # State machine framework
├── fbs/                 # Generated flatbuffer headers
├── logic/               # Core business logic
├── nfc/                 # NFC hardware abstraction
├── drivers/             # Hardware drivers
├── ui/                  # User interface (LVGL)
├── config.h             # Pin assignments
└── entrypoint.cpp       # setup() and loop()
```

## Codestyle

**Copyright Header:**
```cpp
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
```

- Google C++ style guide
- `snake_case.h` / `snake_case.cpp`
- Include `"common.h"` for base includes
- Full path from src/ root for project includes

**Comments should describe WHY, not WHAT changed.**
