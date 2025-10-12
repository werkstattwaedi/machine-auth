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

## Admin Web Application

The admin UI is an Angular 20 single-page application for managing users, permissions, machines, and terminals.

### Tech Stack & Architecture

**Framework:** Angular 20 with standalone components
**UI Library:** Angular Material with custom Werkstatt Wädenswil theme
**Database:** Firebase Firestore (client-side SDK)
**Authentication:** Firebase Auth (Google OAuth + passwordless email link)
**Language:** German throughout

**Key Design Decisions:**
- **Client-side Firebase SDK**: No custom backend API - admin UI talks directly to Firestore
- **Account claiming pattern**: Admins can pre-create user accounts, users claim them via email when they sign in
- **Role-based access**: Users have `roles: string[]` array, admin role checked via `roles.includes('admin')`
- **Reactive data**: All Firestore queries exposed as observables via RxFire
- **Material Design**: Consistent UI with tables, dialogs, chips, and form validation

### Development Setup

**Prerequisites:**
- Node.js (version in `.nvmrc`)
- Firebase CLI: `npm install -g firebase-tools`

**Local Development:**
```bash
cd admin
npm install
npm start  # Runs on http://localhost:4200
```

**Environment Configuration:**
- `src/environments/environment.ts`: Development config (uses Firebase emulators)
- `src/environments/environment.production.ts`: Production config (needs real Firebase credentials)
- Set `useEmulators: false` for production builds

**Build:**
```bash
npm run build  # Output: dist/admin/browser/
```

### Deployment

**Firebase Hosting Configuration:**
The `firebase.json` at project root configures hosting:
```json
{
  "hosting": {
    "public": "admin/dist/admin/browser",
    "predeploy": ["cd admin && npm install && npm run build"],
    "rewrites": [{"source": "**", "destination": "/index.html"}]
  }
}
```

**Deploy:**
```bash
firebase deploy --only hosting
```

**IMPORTANT - Production Checklist:**
- ⚠️ **Firestore security rules** (issue #30): Currently permissive for development, MUST harden before production
- ⚠️ **Firebase credentials**: Replace fake emulator config with real project credentials
- ⚠️ **Bundle size**: Currently 1.42 MB (exceeds budget) - consider lazy loading and code splitting
- ⚠️ Set `useEmulators: false` in production environment

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

#### Permissions Module
Simple CRUD for permission management.
- **Model**: `{ id: string, name: string }`
- **Table**: Lists all permissions
- **Dialog**: Create/edit permission name
- **Location**: `admin/src/app/features/permissions/`

#### Machines & Terminals Module
Tabbed interface for machines and their controlling terminals.
- **Machines Model**: `{ id, name, maco: deviceId, requiredPermission: permissionId[] }`
- **Terminals (MaCo) Model**: `{ id: deviceId, name }`
- **Tab 1**: Machines table with terminal assignment and required permissions (multi-select)
- **Tab 2**: Terminals table with Particle device ID (24-char hex validation)
- **Location**: `admin/src/app/features/machines/`

#### Users & Tokens Module
Master-detail layout for user management with NFC token subcollection.
- **Users Model**: `{ id, email, displayName, name?, firebaseUid?, roles[], permissions[], created }`
- **Tokens Model**: `{ id: ntagUid, userId, label, registered, deactivated? }`
- **Layout**: Left panel = users table, Right panel = selected user details + tokens
- **Features**:
  - User CRUD with role/permission assignment
  - Token subcollection management (add/edit/deactivate/delete)
  - Unclaimed account indicator (no `firebaseUid`)
  - Token ID validation (14-char hex for NTAG UIDs)
- **Location**: `admin/src/app/features/users/`

### Authentication Flow

**Login Methods:**
1. **Google OAuth**: `signInWithPopup(GoogleAuthProvider)`
2. **Email Link**: Passwordless - send link to email, user clicks to sign in

**Account Claiming Pattern:**
```typescript
// On successful sign-in:
1. Check if user doc exists with matching email but no firebaseUid
2. If yes: Update doc with firebaseUid (claim account)
3. If no: Create new user doc with firebaseUid
```

This allows admins to pre-create users and assign permissions/tokens before the user ever signs in.

**Role Checking:**
```typescript
// Admin guard checks:
userDoc.roles.includes('admin')

// Available roles:
- 'admin': Full system access
- 'vereinsmitglied': Regular club member
```

**Auth Service Location**: `admin/src/app/core/services/auth.service.ts`

### Firestore Integration

**Pattern: Direct client-side Firestore access**
- All services use AngularFire (`@angular/fire/firestore`)
- Reactive queries via `collectionData()` → Observable
- CRUD operations via `addDoc`, `updateDoc`, `deleteDoc`, `setDoc`

**Example Service Pattern:**
```typescript
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private firestore = inject(Firestore);
  private collection = collection(this.firestore, 'permission');

  getPermissions(): Observable<PermissionWithId[]> {
    return collectionData(this.collection, { idField: 'id' });
  }

  async createPermission(data: PermissionDocument): Promise<string> {
    const docRef = await addDoc(this.collection, data);
    return docRef.id;
  }
}
```

**Subcollections Pattern (Tokens):**
```typescript
// Tokens stored at: users/{userId}/token/{tokenId}
getUserTokens(userId: string): Observable<TokenWithId[]> {
  const tokensCollection = collection(this.firestore, `users/${userId}/token`);
  return collectionData(tokensCollection, { idField: 'id' });
}
```

### UI Patterns & Best Practices

**Component Naming:**
- All components must end with `Component` suffix (e.g., `PermissionsComponent`)
- Dialog components: `*DialogComponent` (e.g., `PermissionDialogComponent`)

**Template Patterns:**
- Use `@if`, `@for` (new Angular control flow syntax, not `*ngIf`/`*ngFor`)
- Async pipe for observables: `@if (users$ | async; as users)`
- Material table: `<table mat-table [dataSource]="items">`

**Form Validation:**
- Reactive forms with `FormBuilder`
- Inline error messages: `@if (form.get('field')?.hasError('required'))`
- German error messages throughout

**German UI Text Guidelines:**
- Buttons: "Erstellen" (Create), "Speichern" (Save), "Abbrechen" (Cancel), "Löschen" (Delete)
- Tables: "Aktionen" (Actions), "Name", "E-Mail"
- Messages: "Berechtigung erstellt" (Permission created), "Fehler: ..." (Error: ...)
- Empty states: "Noch keine ... vorhanden" (No ... available yet)

**Material Theme:**
Custom theme with Werkstatt Wädenswil brand colors:
- Primary: Yellow `#F9C74F`
- Accent: Blue `#90B8D8`
- Theme file: `admin/src/theme.scss`

### Common Tasks

**Add a new CRUD module:**
1. Generate component: `ng generate component features/my-module`
2. Create model interface in `core/models/`
3. Create service in `core/services/`
4. Build table component with Material table
5. Create dialog component for create/edit
6. Add route to `app.routes.ts` with appropriate guards
7. Add navigation item to `main-layout.ts`

**Add a field to existing model:**
1. Update interface in `core/models/*.model.ts`
2. Update form in dialog component
3. Update table columns in list component
4. Update service methods if needed

**Debug Firestore queries:**
1. Open browser DevTools → Network tab
2. Filter by "firestore.googleapis.com"
3. Check request/response payloads
4. Verify security rules in Firebase console

### Known Issues

**Issue #30: Permissive Firestore Rules**
Current rules allow all authenticated users to read/write everything. Must implement proper role-based rules before production:
```javascript
// TODO: Implement rules like:
match /users/{userId} {
  allow read: if request.auth != null;
  allow write: if request.auth.token.admin == true;
}
```

**Bundle Size Warning:**
Build exceeds 1 MB budget (currently 1.42 MB). Future optimization:
- Lazy load feature modules
- Tree-shake unused Material components
- Code splitting for dialogs
