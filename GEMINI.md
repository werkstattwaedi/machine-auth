# Machine Authentication System - AI Context Documentation

TODO - this document is not done. Ask me when more information is needed

## Project Overview

This is a comprehensive IoT machine authentication system built with Particle IoT firmware, featuring secure NFC-based access control, usage tracking, and cloud synchronization. The system consists of three main components:

- **Firmware**: Particle IoT device firmware (C++) for machine control
- **Functions**: Firebase Cloud Functions (TypeScript) for backend logic
- **Admin**: Angular web application for system administration

## Firmware

### Particle Firmware Compilation

The firmware uses the Particle IoT development environment, which requires to run the compilation via either of these ways

- Use VS Code command palette. Command: `Particle: Compile application (local)`
- via VS Code task system. Command ID `particle.compileApplicationLocal`

Compilation exits with code 0 for success, code 2 for errors. Wait for the terminal to complete. Error markers from the previous compilation persist, so make sure to recompile before assessing the markers in the editor.

Do not try to compile by invoking make directly, it will not work due missing environment variables.

### Flatbuffer Schema Generation

The project uses flatbuffers for efficient data serialization:

```bash
cd schema/
make  # Generates .h files in firmware/src/fbs/
```

### Particle IoT API Usage Patterns

Prefer using C++17 std library functions. Then, check for particle API, there is wiring API for many applications.
Find the API here: #fetch https://docs.particle.io/reference/device-os/firmware/.

Specifically, prefer `std::string` over the particle `String`, convert as late as possible. The codebase is not there yet, but work towards it. also prefer std::array over regular arrays. We use the specific uint8_t, int16_t and related types whenever possible. 

use std::chrono related types for everything time.

### Cloud Communication

To send request to the backend server, use `SendTerminalRequest`. The actual Request / Response API is defined as
flatbuffers, in `/schema/`. They are generated, and can be found in firmware/src/fbs

**CloudRequest Template Pattern:**

```cpp
template<typename RequestType, typename ResponseType>
tl::expected<ResponseType, ErrorType> SendTerminalRequest(
    const RequestType& request,
    const std::string& endpoint
);

// Usage example:
auto result = cloud_request_.SendTerminalRequest<fbs::UploadUsageRequestT, fbs::UploadUsageResponseT>(
    upload_request, "upload-usage"
);
```

### Architecture Patterns

#### State Management

Mostly using a state machine for managing longer-lived state

**Variant-Based State Machine:**

```cpp
using State = std::variant<MachineIdle, MachineActive, Denied>;
State current_state_;

// State transitions
current_state_ = MachineActive{token_session, start_time};
```

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

### Module Organization

```
src/
├── common/           # Shared utilities
├── fbs/             # Generated flatbuffer headers
├── nfc/             # NFC communication
├── setup/           # Device setup and configuration
├── state/           # State management
│   ├── session/     # Session-related states
│   └── tag/         # Tag-related states
└── ui/              # User interface
```

## Cloud Integration Notes

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

The projct uses cloud functions to handle requests, the entry points are defined in src/index.ts. The request / response data is always base64 encoded flatbuffer data. The schema for the flatbuffers can be found in schema/\*.fbs (outside of the functions subproject). The typescript code is generated in src/fbs.

The project uses a firestore database. A sample structure can be found in firestore/schema.jsonc. Read this before making assumptions on the schema.
