# Machine Authentication System - AI Context Documentation

**Note:** This document provides AI-specific development context (patterns, commands, gotchas). For architectural decisions and requirements, see [`docs/`](docs/README.md).

## Project Overview

This is a comprehensive IoT machine authentication system built with Particle IoT firmware, featuring secure NFC-based access control, usage tracking, and cloud synchronization. The system uses NTAG424 DNA NFC tags for secure mutual authentication.

### System Components

- **Firmware**: Particle IoT device firmware (C++, ~15k LOC) for machine control
- **Functions**: Firebase Cloud Functions (TypeScript) for backend authentication logic
- **Admin**: Angular web application for system administration

### Documentation Structure

- **`CLAUDE.md`** (this file): AI development context, patterns, commands
- **`docs/`**: Structured project documentation
  - `docs/config.md`: **Complete configuration guide for new environments**
  - `docs/compile.md`: Firmware build instructions
  - `docs/adr/`: Architecture Decision Records - why we made key technical choices
  - `docs/requirements/`: Product requirements and specifications
  - `docs/ideas/`: Exploration, brainstorming, future work
  - See [`docs/README.md`](docs/README.md) for full guide

**When to update docs during sessions:**
- Create an ADR when making significant architectural decisions (e.g., choosing between approaches)
- Update `docs/ideas/backlog.md` when discovering future work
- Update CLAUDE.md for development patterns, build commands, and AI-specific context
- Don't over-document - focus on capturing "why" for decisions that aren't obvious from code

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

### Compilation

**CRITICAL: Always use the build scripts documented in [`docs/compile.md`](docs/compile.md). Never run `cmake`, `make`, or `neopo` directly.**

**Quick Reference:**

```bash
# Compile Particle firmware (from anywhere)
firmware/neopo.sh compile

# Build and run simulator (from anywhere)
firmware/simulator/run.sh --state idle

# Or just compile simulator
firmware/simulator/build.sh
```

For setup instructions, troubleshooting, and detailed information, see [`docs/compile.md`](docs/compile.md).

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

**CRITICAL - Timing Functions:**
- ✅ **`timeSinceBoot()`** from `common/time.h` - returns monotonic time since device boot
- ✅ **`timeUtc()`** from `common/time.h` - returns current UTC time
- ❌ **NEVER use `std::chrono::steady_clock::now()`** - not available in Particle Device OS linker
- ❌ **NEVER use `std::chrono::system_clock::now()`** - use `timeUtc()` instead

**Rationale:** Particle Device OS does not provide the standard C++ `steady_clock` or `system_clock` implementations. Always use the wrapper functions from `common/time.h` which properly interface with the Particle time APIs.

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
if (state::IsPending(*response)) {
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

The codebase uses a custom variant-based state machine template (`state/state_machine.h`) for managing complex state.

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
using MachineStateMachine = oww::state::StateMachine<
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
- `NfcStateMachine` (`nfc/states.h`): WaitForTag → TagPresent → Ntag424Authenticated → WaitForTag
- `MachineStateMachine` (`logic/session/machine_state.h`): Idle ⇄ Active / Denied
- `SessionCreationStateMachine` (`state/session_creation.h`): Begin → AwaitStartSessionResponse → ... → Succeeded/Rejected/Failed

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

Cloud requests return `std::shared_ptr<state::CloudResponse<T>>` which is a variant:
```cpp
using CloudResponse<T> = std::variant<state::Pending, T, ErrorType>;

auto response = cloud_request_.SendTerminalRequest<RequestT, ResponseT>(...);

// Check if ready
if (state::IsPending(*response)) {
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
- **UI thread** (`ui/platform/maco_ui.cpp`): LVGL display updates
- **LED thread** (`ui/platform/maco_ui.cpp`): LED rendering at fixed frame rate

**Thread Safety:**
- Use mutexes for shared state (`WITH_LOCK()` macro)
- `Application` has a mutex for cross-thread access
- `NfcTags::QueueAction()` safely queues actions from main thread to NFC thread

**CRITICAL - Static Variables in Multi-Threaded Code:**
- ❌ **NEVER use static local variables** accessed from multiple threads without mutex protection
- Static locals are shared across all threads but lack inherent synchronization
- Common bug pattern: throttling mechanisms using `static system_tick_t last_check = 0`
- ✅ **Always use mutex-protected member variables** for shared state across threads

**Example of the bug:**
```cpp
// ❌ DANGEROUS - race condition
bool Check() {
  static system_tick_t last_check_time = 0;  // Shared, unprotected!
  if (now - last_check_time < 1000) return true;
  last_check_time = now;  // Multiple threads can interleave here
}

// ✅ SAFE - mutex-protected member
bool Check() {
  os_mutex_lock(mutex_);
  if (now - last_check_time_ < 1000) {
    os_mutex_unlock(mutex_);
    return true;
  }
  last_check_time_ = now;
  os_mutex_unlock(mutex_);
}
```

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
#include "logic/session/token_session.h"
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

#### Naming Conventions

**Avoid Generic "Manager" Suffixes:**
- ❌ `EffectManager` - vague, could mean anything
- ✅ `Crossfade` - specific, describes what it does
- ❌ `DataManager` - what kind of management?
- ✅ `SessionRegistry` or `SessionCache` - clear responsibility

**Principle:** Class names should describe their specific responsibility, not generic roles. Reserve "Manager" for true orchestrators that coordinate multiple subsystems.

### Module Organization

```
firmware/src/
├── common/              # Shared utilities and base includes
│   ├── expected.h       # tl::expected for error handling
│   ├── status.h         # ErrorType and Status enums
│   ├── time.h/cpp       # std::chrono wrappers for Particle time APIs
│   └── debug.h          # Logging helpers
├── state/               # Public state types and state machine framework
│   ├── state_machine.h  # Generic variant-based state machine template
│   ├── cloud_response.h # CloudResponse variant type
│   └── session_creation.h # Session creation state machine
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
│       ├── session_coordinator.* # Session state coordinator
│       └── machine_state.*      # Machine state machine
├── nfc/                 # NFC hardware abstraction
│   ├── nfc_tags.*       # NFC worker thread, tag state machine
│   ├── states.h         # NFC state definitions
│   └── driver/          # Low-level NFC hardware drivers
│       ├── PN532.*      # PN532 NFC reader (UART)
│       └── Ntag424.*    # NTAG424 DNA tag protocol
├── drivers/             # Other hardware drivers
│   ├── buzzer/          # Buzzer control
│   ├── display/         # Display drivers
│   ├── neopixels/       # LED ring (WS2812)
│   └── relay/           # Relay control
├── hal/                 # Hardware abstraction layer
├── setup/               # Device setup mode for provisioning
├── ui/                  # User interface (LVGL-based)
│   ├── platform/
│   │   └── maco_ui.*    # MACO platform implementation (singleton)
│   │                    # - Unified platform layer: display, touch, LEDs, buzzer
│   │                    # - Implements IHardware interface
│   │                    # - Manages UI thread and LED thread
│   │                    # - Entry point: MacoUI::instance().Begin()
│   ├── core/
│   │   └── ui_manager.* # Platform-independent UI state & screen management
│   ├── components/      # Reusable UI components (ButtonBar, SessionStatus, etc.)
│   ├── leds/            # LED effect system
│   │   ├── crossfade.*  # Crossfading effect implementation
│   │   └── multiplexer.*# Multiplexes multiple LED effects
│   └── screens/         # LVGL screen definitions
├── config.h             # Pin assignments and hardware config
├── entrypoint.cpp       # setup() and loop() - Particle entry points
└── faulthandler.*       # Crash handler and diagnostics
```

### Platform Architecture

**MacoUI: Unified Platform Layer**

`ui/platform/maco_ui.{h,cpp}` is the **canonical MACO platform implementation**. It consolidates all platform-specific initialization:

- Display initialization (ILI9341 via SPI)
- Touch button mapping
- LED strip initialization (WS2812 NeoPixel)
- Buzzer configuration
- UI thread management
- LED rendering thread

**Design Principle:** Platform code is unified in one location (`ui/platform/`), not split between `drivers/` and `ui/`. MacoUI implements `IHardware` interface to provide hardware abstraction to platform-independent UI components.

**When porting to new hardware:**
- Copy `ui/platform/maco_ui.*` as template
- Implement display, touch, LED, buzzer for new platform
- Platform-independent code in `ui/core/` and `ui/components/` works unchanged

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

**Build Structure:**

TypeScript compiles to `functions/lib/src/` (preserving source directory structure):
- `package.json` must have `"main": "lib/src/index.js"` (NOT `lib/index.js`)
- Entry point: `lib/src/index.js` exports the `api` cloud function
- Tests: `lib/test/integration/**/*.test.js`

**IMPORTANT:** After changing `tsconfig.json` or if deployment uploads stale code, do a clean rebuild:
```bash
cd functions/
rm -rf lib/
npm run build
```

**Deployment:**

```bash
cd functions/
npm run build
firebase deploy --only functions
```

The `predeploy` hook in `firebase.json` runs `npm run build` automatically, but if you suspect stale files, do a manual clean rebuild first.

**Local Development:**

```bash
cd functions/
npm run serve  # Local Firebase emulator
```

**Testing:**

```bash
cd functions/
npm run test:integration  # Runs tests with Firestore emulator
npm run test:unit         # Unit tests only
npm run test              # All tests
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

#### DocumentReferences vs String Paths

**CRITICAL: Always use Firestore DocumentReferences, NEVER string paths**

All foreign key relationships in Firestore MUST be stored as `DocumentReference` objects, not string paths like `/users/xyz`.

**Correct Pattern:**
```typescript
// Creating documents with references
await sessionRef.set({
  userId: userDoc.ref,           // ✅ DocumentReference
  tokenId: tokenDoc.ref,         // ✅ DocumentReference
  // ...
});

// Querying with references
const sessions = await db
  .collection('sessions')
  .where('tokenId', '==', tokenDoc.ref)  // ✅ Query with DocumentReference
  .get();

// Reading referenced documents
const sessionData = sessionDoc.data() as SessionEntity;
const userDoc = await sessionData.userId.get();  // ✅ Call .get() on reference
const userId = userDoc.id;                       // ✅ Extract ID from document
```

**Wrong Pattern (deprecated):**
```typescript
// ❌ NEVER do this:
await sessionRef.set({
  userId: `/users/${userId}`,     // ❌ String path
  tokenId: `/tokens/${tokenId}`,  // ❌ String path
});

// ❌ NEVER do this:
const userDoc = await db.collection('users').doc(userId).get();
```

**TypeScript Entity Interfaces:**

Define entity interfaces in `functions/src/types/firestore_entities.ts` to enforce DocumentReference types at compile time:

```typescript
export interface SessionEntity {
  userId: DocumentReference;     // Reference to /users/{userId}
  tokenId: DocumentReference;    // Reference to /tokens/{tokenId}
  startTime: Timestamp;
  rndA?: Uint8Array;
  usage: UsageRecordEntity[];
  closed?: { time: Timestamp; metadata: string };
}
```

Cast Firestore data at boundaries, then trust TypeScript:
```typescript
const sessionData = sessionDoc.data() as SessionEntity;
// No runtime validation needed - TypeScript enforces correct types
const userDoc = await sessionData.userId.get();
```

**Test Helpers:**

The test infrastructure (`functions/test/emulator-helper.ts`) automatically converts string paths to DocumentReferences:

```typescript
await seedTestData({
  sessions: {
    [sessionId]: {
      userId: `/users/${userId}`,     // Auto-converted to DocumentReference
      tokenId: `/tokens/${tokenId}`,  // Auto-converted to DocumentReference
    }
  }
});
```

**Firestore Security Rules:**

Validate DocumentReference types in security rules (`firestore/firestore.rules`):

```javascript
function isDocumentReference(field, collection) {
  return field is path && field.matches('^/' + collection + '/[^/]+$');
}

match /sessions/{sessionId} {
  allow create: if isDocumentReference(request.resource.data.userId, 'users') &&
                   isDocumentReference(request.resource.data.tokenId, 'tokens');
}
```

**Why DocumentReferences?**
1. Type safety - Firestore enforces referential integrity
2. Easier queries - no string parsing or path construction
3. Cleaner code - `.get()` instead of manual path building
4. Better performance - Firestore optimizes reference queries

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

## Admin Web Application

Angular 20 SPA for managing users, permissions, machines, and terminals. All code in `admin/`.

### Quick Start

```bash
cd admin
npm install
npm start  # http://localhost:4200 with emulators
```

### Tech Stack

- **Framework**: Angular 20 (standalone components, new control flow)
- **UI**: Angular Material with custom Werkstatt Wädenswil theme (yellow/blue)
- **Database**: Firebase Firestore (client-side SDK, no backend API)
- **Auth**: Firebase Auth (Google OAuth + passwordless email link)
- **Language**: German UI throughout

### Key Architecture Decisions

**Client-side Firestore** - Admin UI talks directly to Firestore, no custom backend. Security enforced by Firestore rules, not API layer.

**Account Claiming Pattern** - Admins pre-create users with email/permissions/tokens. When user signs in with that email, account is "claimed" by linking their `firebaseUid`. Allows setup before user onboarding.

**Role-based Access** - `userDoc.roles.includes('admin')` for authorization. Available roles: `admin`, `vereinsmitglied`.

### Build & Deploy

```bash
# Build
npm run build  # Output: dist/admin/browser/

# Deploy to Firebase Hosting
firebase deploy --only hosting  # Auto-builds via predeploy hook
```

**Production Checklist:** See [`docs/requirements/admin-ui-deployment.md`](docs/requirements/admin-ui-deployment.md) for deployment requirements and gotchas.

### Module Structure

```
admin/src/app/
├── core/                    # Services, models, guards
│   ├── guards/
│   │   ├── auth.guard.ts    # Requires authentication
│   │   └── admin.guard.ts   # Requires admin role
│   ├── models/              # TypeScript interfaces matching Firestore schema
│   │   ├── user.model.ts    # UserDocument, UserWithId
│   │   ├── permission.model.ts
│   │   ├── machine.model.ts # MachineDocument, MacoDocument
│   │   └── token.model.ts   # TokenDocument (NFC tags)
│   └── services/            # Firestore operations
│       ├── auth.service.ts  # Authentication + account claiming
│       ├── user.service.ts  # User CRUD + token management
│       ├── permission.service.ts
│       └── machine.service.ts
├── features/                # Feature modules
│   ├── auth/login/          # Login page (Google OAuth + email link)
│   ├── dashboard/           # Dashboard (placeholder)
│   ├── permissions/         # Permissions CRUD
│   ├── machines/            # Machines + Terminals CRUD (tabbed)
│   ├── users/               # Users + Tokens CRUD (master-detail)
│   ├── sessions/            # Sessions viewer (placeholder)
│   └── profile/             # User profile (placeholder)
├── shared/                  # Shared components
│   └── layout/main-layout/  # Sidenav layout with role-based navigation
└── app.routes.ts            # Route configuration
```

### CRUD Modules

Three core modules with complete create/read/update/delete functionality:

- **Permissions** (`features/permissions/`) - Simple table, create/edit dialog
- **Machines & Terminals** (`features/machines/`) - Tabbed interface, machine→terminal assignment
- **Users & Tokens** (`features/users/`) - Master-detail layout, token subcollection management

All use Material tables + dialogs with German UI and form validation.

### Development Patterns

**Service Pattern** - AngularFire with observables:
```typescript
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private firestore = inject(Firestore);

  getPermissions(): Observable<PermissionWithId[]> {
    return collectionData(collection(this.firestore, 'permission'), { idField: 'id' });
  }
}
```

**Component Naming** - Always suffix with `Component` (e.g., `PermissionsComponent`, `PermissionDialogComponent`)

**Templates** - Use new Angular control flow: `@if`, `@for` (not `*ngIf`/`*ngFor`)

**German UI** - All text in German: "Erstellen" (Create), "Speichern" (Save), "Abbrechen" (Cancel), "Löschen" (Delete)

**Theme** - Werkstatt colors: Primary yellow `#F9C74F`, Accent blue `#90B8D8` (see `admin/src/theme.scss`)

### Adding CRUD Modules

1. Generate: `ng generate component features/my-module`
2. Create model in `core/models/`
3. Create service in `core/services/` (extends AngularFire pattern)
4. Build table + dialog components
5. Add route to `app.routes.ts` with guards
6. Add nav item to `main-layout.ts`

### Known Issues

- **Issue #30**: Firestore rules permissive (development only - harden before prod)
- **Bundle size**: 1.42 MB exceeds budget - needs lazy loading
- See [`docs/requirements/admin-ui-deployment.md`](docs/requirements/admin-ui-deployment.md) for production checklist
