# Machine Authentication System - AI Context Documentation

**Note:** This document provides AI-specific development context (patterns, commands, gotchas). For architectural decisions and requirements, see [`docs/`](docs/README.md).

## Project Overview

This is a comprehensive IoT machine authentication system featuring secure NFC-based access control, usage tracking, and cloud synchronization. The system uses NTAG424 DNA NFC tags for secure mutual authentication.

### System Components

| Component | Location | Description |
|-----------|----------|-------------|
| **MACO Firmware** | `maco_firmware/` | Pigweed-based firmware (Bazel build) |
| **Functions** | `functions/` | Firebase Cloud Functions (TypeScript) |
| **Admin** | `admin/` | Angular web application |

**Component-specific documentation:**
- [`maco_firmware/CLAUDE.md`](maco_firmware/CLAUDE.md) - Pigweed patterns, building, architecture
- [`third_party/particle/CLAUDE.md`](third_party/particle/CLAUDE.md) - Particle Pigweed backends

### Build Commands (MACO Firmware)

**For Claude (AI assistant) - always use `./pw`:**

```bash
./pw build host    # Build simulator (no IDE change)
./pw build p2      # Build P2 firmware (no IDE change)
./pw flash         # Flash to device
./pw build asan    # Address Sanitizer
```

**For human developers:**
- `bazel build ...` → Updates IDE compile_commands to match target
- `./pw ...` → No IDE changes (use for flash, sanitizers)

See [`docs/adr/0009-local-build-flash-tooling.md`](docs/adr/0009-local-build-flash-tooling.md) for details.

### Documentation Structure

- **`docs/`**: Structured project documentation
  - `docs/config.md`: Complete configuration guide for new environments
  - `docs/compile.md`: Firmware build instructions
  - `docs/adr/`: Architecture Decision Records
  - `docs/requirements/`: Product requirements and specifications
  - `docs/ideas/`: Exploration, brainstorming, future work

**When to update docs:**
- Create an ADR when making significant architectural decisions
- Update `docs/ideas/backlog.md` when discovering future work
- Update component CLAUDE.md files for development patterns
- Don't over-document - focus on "why" for non-obvious decisions

### How It Works

1. User presents NTAG424 tag to NFC reader on machine terminal
2. Terminal authenticates tag using mutual authentication (3-pass AES-128)
3. Backend verifies user permissions and creates/returns session
4. Machine activates relay to enable equipment
5. Usage data tracked locally and synced to cloud
6. Sessions closed via UI, self-checkout, timeout, or new tag

## Flatbuffer Schema Generation

Shared flatbuffers for cross-platform serialization:

**Schema Files:**
- `schema/ntag.fbs`: Tag UID and key definitions
- `schema/token_session.fbs`: Session RPC service and types
- `schema/machine_usage.fbs`: Usage tracking and checkout reasons
- `schema/ledger_terminal-config.fbs`: Device configuration
- `schema/personalization.fbs`: Tag personalization during setup

**Generate Code:**
```bash
cd schema/
make  # Generates C++ headers and TypeScript
```

## Cloud Integration

### Firebase Operations Budget

**CRITICAL: 100,000 operations/month maximum** (Firebase free tier)

Design decisions to minimize operations:
1. Terminal-side permission checking after session established
2. Local session caching
3. Batch usage uploads
4. Future: Session broadcasting between devices

### Firebase Functions

All code in `functions/`

```bash
cd functions/
npm run build          # Build
npm run serve          # Local emulator
npm run test           # All tests
firebase deploy --only functions
```

**Clean rebuild if stale:**
```bash
rm -rf lib/ && npm run build
```

### Firestore Schema

See `firestore/schema.jsonc` for complete structure.

**Key Collections:**
- `users/{userId}`: User profiles + `token/{tokenId}` subcollection
- `sessions/{sessionId}`: Active and historical sessions
- `machine/{machineId}`: Machine definitions
- `maco/{deviceId}`: Terminal device registrations
- `permission/{permissionId}`: Permission definitions

**CRITICAL: Always use DocumentReferences, not string paths**

```typescript
// Correct
await sessionRef.set({ userId: userDoc.ref });

// Wrong
await sessionRef.set({ userId: `/users/${userId}` });
```

## Admin Web Application

Angular 20 SPA in `admin/`

```bash
cd admin
npm install
npm start  # http://localhost:4200 with emulators
```

**Tech Stack:** Angular 20, Angular Material, Firebase (Firestore + Auth)

**Key Patterns:**
- Client-side Firestore (no custom backend)
- Account claiming (pre-create users, link on sign-in)
- Role-based access (`admin`, `vereinsmitglied`)
- German UI throughout

**Deploy:**
```bash
firebase deploy --only hosting
```

See [`docs/requirements/admin-ui-deployment.md`](docs/requirements/admin-ui-deployment.md) for production checklist.

## Implementation Guidelines

**When encountering blockers:**

If an issue requires a significant workaround (global state hacks, skipping functionality, architectural compromises), **stop and discuss it** instead of implementing the workaround. Explain:
1. What you're trying to do
2. What's blocking you
3. What workaround you'd consider and its downsides

This allows deciding together whether to accept the workaround, find a better solution, adjust the design, or defer the feature.

## Codestyle

**Copyright Header (all new files):**

```cpp
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
```

- Google C++ style guide
- `snake_case` file naming
- Comments describe **why**, not what changed
- Avoid generic "Manager" suffixes
