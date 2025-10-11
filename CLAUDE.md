# Machine Authentication System - AI Context Documentation

## Project Overview

This is a comprehensive IoT machine authentication system built with Particle IoT firmware, featuring secure NFC-based access control, usage tracking, and cloud synchronization. The system uses NTAG424 DNA NFC tags for secure mutual authentication.

### System Components

- **Firmware**: Particle IoT device firmware (C++, ~15k LOC) for machine control
- **Functions**: Firebase Cloud Functions (TypeScript) for backend authentication logic
- **Admin**: Angular web application for system administration

### How It Works

1. User presents NTAG424 tag to NFC reader on machine terminal
2. Terminal authenticates tag using mutual authentication (3-pass AES-128)
3. Backend verifies user permissions and creates/returns session
4. Machine activates relay to enable equipment on successful authentication
5. Usage data (check-in/check-out times) tracked locally and synced to cloud
6. Sessions can be closed via UI, self-checkout, timeout, or new tag presentation

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

**Pin Configuration:**
See `firmware/src/config.h` for complete pin assignments.

**Factory Data:**
Device-specific keys stored in EEPROM at address 0:
```cpp
struct FactoryData {
  uint8_t version;        // EEPROM schema version
  byte key[16];           // AES-128 terminal key
  boolean setup_complete; // Setup mode flag
};
```

**Configuration:**
Device configuration (machine assignments, permissions) stored in Particle Ledger named "terminal-config", synced from Firebase. Flatbuffer schema: `DeviceConfig` in `schema/ledger_terminal-config.fbs`.

## Firmware Development

### Particle Firmware Compilation

The firmware uses local compilation with `neopo`, a tool that manages the Particle toolchain and build environment.

**Prerequisites:**
- `neopo` installed at `/home/michschn/werkstattwaedi/neopo/` (or equivalent path)
- Python virtual environment with neopo package

**Compilation:**

```bash
cd /home/michschn/werkstattwaedi/machine-auth/firmware
source /home/michschn/werkstattwaedi/neopo/.venv/bin/activate
neopo compile
```

**Output:**
- Success: `*** COMPILED SUCCESSFULLY ***` (exit code 0)
- Failure: `*** COMPILE-USER FAILED ***` (exit code 2)
- Binary: `target/p2/firmware.elf` and `target/p2/firmware.bin`
- Bundle: `target/p2/firmware.zip` (includes assets)

**Important Notes:**
- Cloud compilation (`particle compile`) fails due to large LVGL library size
- Do NOT invoke `make` directly - missing environment variables will cause failures
- Error markers from previous compilation persist in editor - always recompile to verify fixes
- Can also use VS Code task: `Particle: Compile application (local)` or command ID `particle.compileApplicationLocal`

### Flatbuffer Schema Generation

The project uses flatbuffers for efficient cross-platform data serialization between firmware, functions, and admin.

**Schema Files:**
- `schema/ntag.fbs`: Tag UID and key definitions
- `schema/token_session.fbs`: Session RPC service and types
- `schema/machine_usage.fbs`: Usage tracking and checkout reasons
- `schema/ledger_terminal-config.fbs`: Device configuration
- `schema/personalization.fbs`: Tag personalization during setup

**Generate Code:**
```bash
cd schema/
make  # Generates:
      # - C++ headers in firmware/src/fbs/
      # - TypeScript in functions/src/fbs/
```

**Important:** Never edit generated files directly. Always modify `.fbs` schemas and regenerate.

### Particle IoT API Usage Patterns

**Preference Hierarchy:**
1. C++17 std library functions (first choice)
2. Particle Wiring API (when std library insufficient)
3. Device OS API (for hardware/cloud features)

Find the Particle API here: #fetch https://docs.particle.io/reference/device-os/firmware/

**Type Preferences:**
- ✅ `std::string` (preferred) → ❌ `String` (convert at API boundaries only)
- ✅ `std::array` → ❌ C-style arrays
- ✅ `std::chrono::time_point`, `std::chrono::seconds` → ❌ `millis()`, `system_tick_t` (except at boundaries)
- ✅ Fixed-width types: `uint8_t`, `int16_t`, etc. → ❌ `int`, `long`

**Note:** The codebase is not fully migrated yet - work towards these patterns when touching code.

### Cloud Communication

All cloud communication uses the Particle Cloud publish/subscribe mechanism with webhook integration to Firebase Functions.

**Request Flow:**
1. Firmware publishes to `terminalRequest` event with JSON payload
2. Particle webhook forwards to Firebase Function endpoint
3. Firebase Function processes and publishes response
4. Firmware subscribes to `{deviceId}/hook-response/terminalRequest/` for responses

**CloudRequest Template Pattern:**

```cpp
// Sends async request and returns shared_ptr to response container
template<typename RequestType, typename ResponseType>
std::shared_ptr<CloudResponse<ResponseType>> SendTerminalRequest(
    String command,
    const RequestType& request,
    system_tick_t timeout_ms = CONCURRENT_WAIT_FOREVER
);

// Usage - asynchronous pattern
auto response = cloud_request_.SendTerminalRequest<
    fbs::StartSessionRequestT,
    fbs::StartSessionResponseT>("startSession", request);

// Later, check if response is ready
if (IsPending(*response)) {
    return;  // Not ready yet, try again next loop
}

// Get the result
auto start_session_response = std::get_if<fbs::StartSessionResponseT>(response);
if (!start_session_response) {
    auto error = std::get<ErrorType>(*response);
    // Handle error
}
```

**Available Endpoints:**
- `startSession`: Check for existing session or initiate authentication
- `authenticateNewSession`: Begin 3-pass mutual authentication
- `completeAuthentication`: Complete authentication and create session
- `uploadUsage`: Upload machine usage history
- `personalize`: Key diversification during tag setup

**Request/Response Format:**
All payloads are base64-encoded flatbuffers defined in `schema/*.fbs`

### Architecture Patterns

#### State Management

The codebase uses a custom variant-based state machine template (`common/state_machine.h`) for managing complex state.

**State Machine Pattern:**

```cpp
// Define states as simple structs
namespace machine_state {
struct Idle {};
struct Active {
  std::shared_ptr<TokenSession> session;
  std::chrono::time_point<std::chrono::system_clock> start_time;
};
struct Denied {
  std::string message;
  std::chrono::time_point<std::chrono::system_clock> time;
};
}

// Create state machine
using MachineStateMachine = oww::common::StateMachine<
    machine_state::Idle,
    machine_state::Active,
    machine_state::Denied>;

auto state_machine_ = MachineStateMachine::Create(
    std::in_place_type<machine_state::Idle>);

// Register handlers
state_machine_->OnLoop<machine_state::Active>(
    [this](auto& state) { return OnActive(state); });

// Transition
state_machine_->TransitionTo(machine_state::Active{
    .session = session,
    .start_time = now,
});

// Query state
if (state_machine_->Is<machine_state::Active>()) { ... }
```

**Key State Machines:**
- `NfcStateMachine`: WaitForTag → TagPresent → Ntag424Authenticated → WaitForTag
- `MachineStateMachine`: Idle ⇄ Active / Denied
- `StartSessionAction`: Internal state machine for multi-step cloud authentication

#### Error Handling

**tl::expected Pattern:**

```cpp
tl::expected<void, ErrorType> CheckIn();
tl::expected<void, ErrorType> CheckOut();

// Usage
auto result = machine_usage_.CheckIn(token_session);
if (!result) {
    // Handle error: result.error()
    return result.error();
}
```

**CloudResponse Pattern:**

Cloud requests return `std::shared_ptr<CloudResponse<T>>` which is a variant:
```cpp
using CloudResponse<T> = std::variant<Pending, T, ErrorType>;

auto response = cloud_request_.SendTerminalRequest<RequestT, ResponseT>(...);

// Check if ready
if (IsPending(*response)) {
    return nullptr;  // Not ready yet
}

// Get result
auto result = std::get_if<ResponseT>(response);
if (!result) {
    auto error = std::get<ErrorType>(*response);
    // Handle error
}
```

#### Threading Model

The firmware uses multiple threads:
- **Main thread**: Application logic, state machines
- **NFC thread** (`nfc/nfc_tags.cpp`): Dedicated NFC polling loop, higher priority
- **UI thread** (`ui/ui.cpp`): LVGL display updates

**Thread Safety:**
- Use mutexes for shared state (`WITH_LOCK()` macro)
- `Application` has a mutex for cross-thread access
- `NfcTags::QueueAction()` safely queues actions from main thread to NFC thread

### Codestyle

using directory based namespaces, with an implicit `oww` namespace for most files in the project. Follow the google C++ style guide, as described here: #fetch https://google.github.io/styleguide/cppguide.html

#### Header Organization

Prefer forward declarations in headers over an include for project specific files (the ones in `src/`). Library files are preferd to be included in the header directly.

Always include "common.h" for a base set of includes. Write full path from src/ root for project includes.

**Include Patterns:**

```cpp
// System includes
#include "common.h"
#include <vector>
#include <variant>

// Project includes
#include "state/session/token_session.h"
#include "fbs/machine_usage_generated.h"
```

#### File Naming Conventions

- **Headers:** `snake_case.h`
- **Implementation:** `snake_case.cpp`

#### Commenting Guidelines

**IMPORTANT: Comments should describe WHY, not WHAT changed**

❌ **Bad - describes the change process:**
```cpp
led_positions_[14] = {x, y, size};  // Swapped with 15
led_positions_[3] = {x, y, size};   // Swapped 2<->3
```

✅ **Good - describes the intent or layout:**
```cpp
// Right side: 0, 14, 15 (bottom to top)
led_positions_[0] = {x, y, size};
led_positions_[15] = {x, y, size};
led_positions_[14] = {x, y, size};

// NFC area: 3, 2 (left to right)
led_positions_[3] = {x, y, size};
led_positions_[2] = {x, y, size};
```

**Rationale:** Comments describing changes ("swapped", "inverted", "fixed") only make sense during development but confuse future readers. Change history belongs in commit messages and chat logs, not in code. Comments should help readers understand the system's design and intentions.

### Module Organization

```
firmware/src/
├── common/              # Shared utilities and base includes
│   ├── state_machine.h  # Generic variant-based state machine template
│   ├── expected.h       # tl::expected for error handling
│   ├── status.h         # ErrorType and Status enums
│   ├── time.h/cpp       # std::chrono wrappers for Particle time APIs
│   └── debug.h          # Logging helpers
├── fbs/                 # Generated flatbuffer headers (don't edit manually)
├── logic/               # Core business logic
│   ├── application.h/cpp        # Main app entry point, coordinates subsystems
│   ├── configuration.h/cpp      # Device config from Particle ledger, factory data in EEPROM
│   ├── cloud_request.h/cpp      # Template-based cloud RPC system
│   ├── action/                  # NFC tag actions
│   │   ├── start_session.*      # Multi-step session creation with cloud
│   │   └── personalize.*        # Tag personalization during setup
│   └── session/                 # Session and usage tracking
│       ├── sessions.*           # Session registry and management
│       ├── token_session.*      # Individual session data
│       └── machine_state.*      # Machine state machine (Idle/Active/Denied)
├── nfc/                 # NFC hardware abstraction
│   ├── nfc_tags.*       # NFC worker thread, tag state machine
│   └── driver/          # Low-level hardware drivers
│       ├── PN532.*      # PN532 NFC reader (I2C/SPI)
│       └── Ntag424.*    # NTAG424 DNA tag protocol
├── setup/               # Device setup mode for provisioning
├── ui/                  # User interface (LVGL-based)
│   ├── ui.*             # UI thread and main screens
│   ├── driver/          # Display and touch hardware
│   └── leds/            # WS2812 LED ring controller
├── config.h             # Pin assignments and hardware config
├── entrypoint.cpp       # setup() and loop() - Particle entry points
└── faulthandler.*       # Crash handler and diagnostics
```

## Cloud Integration Notes

### Firebase Operations Budget Constraint

**CRITICAL REQUIREMENT: 100,000 operations/month maximum**

The project must stay within Firebase free tier limits of 100K read/write operations per month. This hard constraint drives several architectural decisions:

**Design Decisions to Minimize Operations:**
1. **Terminal-side permission checking**: Authentication happens in cloud (crypto security), but permission validation happens locally on the device after session is established
2. **Local session caching**: Once a session is active, subsequent badge-ins on the same terminal don't query the cloud
3. **Batch usage uploads**: Usage records are stored locally and uploaded in batches rather than real-time
4. **Future: Session broadcasting** (planned): When a session becomes active, broadcast to other devices so they can cache it without querying cloud on every badge-in

**Always consider Firebase operation cost when:**
- Adding new cloud queries
- Implementing real-time features
- Designing data sync patterns
- Broadcasting state changes

### Firebase Functions

All code is in `functions/`

**Deployment:**

```bash
cd functions/
npm run build
firebase deploy --only functions
```

**Local Development:**

```bash
cd functions/
npm run serve  # Local Firebase emulator
```

### Architectural Patterns

The project uses cloud functions to handle requests, the entry points are defined in `functions/src/index.ts`.

**Request/Response Flow:**
1. All requests come via Particle webhook with authentication middleware
2. Request data is base64-encoded flatbuffer in `req.body.data`
3. Each handler unpacks request, processes, and returns flatbuffer response
4. Response includes same `id` from request for correlation

**Handler Structure:**
```typescript
export const startSessionHandler = async (req: express.Request, res: express.Response) => {
  const responseFbs = await handleStartSession(
    unpackRequest(req, (buffer) =>
      StartSessionRequest.getRootAsStartSessionRequest(buffer).unpack()
    ),
    (req as any).config
  );
  sendFlatbufferSuccessResponse(req, res, responseFbs);
};
```

**Available Handlers:**
- `handleStartSession`: Check existing sessions or request authentication
- `handleAuthenticateNewSession`: Generate cloud challenge for NTAG mutual auth
- `handleCompleteAuthentication`: Verify tag response and create session
- `handleUploadUsage`: Store usage records in Firestore
- `handleKeyDiversification`: Derive device-specific keys during personalization

### Firestore Schema

The project uses a Firestore database. The structure is documented in `firestore/schema.jsonc`.

**Key Collections:**
- `users/{userId}`: User profiles with permissions and roles
  - `token/{tokenId}`: User's registered NTAG424 tags (subcollection)
- `sessions/{sessionId}`: Active and historical sessions
  - Includes `usage[]` array of machine check-ins/check-outs
  - `closed` field indicates session termination
- `machine/{machineId}`: Machine definitions and required permissions
- `maco/{deviceId}`: Machine Controller (terminal) device registrations
- `permission/{permissionId}`: Permission definitions

**Important:** Always read `firestore/schema.jsonc` before making assumptions about the database structure.

### Session Lifecycle

**Session Creation:**
1. Tag presented → `StartSession` RPC
2. If no valid session exists → `AuthenticateNewSession` (begin mutual auth)
3. Terminal completes challenge/response with tag
4. `CompleteAuthentication` verifies and creates session
5. Backend returns `TokenSession` with user info and permissions

**Session Usage:**
1. `MachineUsage::CheckIn()` checks permissions and creates usage record
2. Relay activated, machine turns on
3. On checkout (UI/timeout/new tag) → `MachineUsage::CheckOut()`
4. Usage record completed with checkout reason
5. `UploadHistory()` syncs usage data to cloud (via `uploadUsage` endpoint)
