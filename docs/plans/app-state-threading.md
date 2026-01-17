# Plan: Application State Threading Model

## Summary

Implement thread-safe application state management using `pw::sync::Mutex` with quick reads. The state lives on the main thread, is updated via events, and can be safely read from the UI thread using a snapshot pattern.

**Scope:** Threading infrastructure validated with real use case (NFC tag detection). Uses a **placeholder FSM** (NoTag/HasTag) with tag UID to validate the pattern. Full HFSM designed separately.

**Module:** `modules/app_state/` - Central firmware state management

**Validation:** Modify `nfc_test_screen.cc` to read state from AppState (UI thread) instead of directly from NfcReader (cross-thread).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Main Thread (pw_async2 Dispatcher)          │
├─────────────────────────────────────────────────────────────┤
│  NfcReader task ──────────> AppState                        │
│      OnTagDetected(uid)         │                           │
│      OnTagRemoved()             │ mutex-protected update    │
└─────────────────────────────────────────────────────────────┘
                                  │
                                  │ GetSnapshot(out&) - lock, copy, unlock
                                  v
┌─────────────────────────────────────────────────────────────┐
│                 UI Thread (RenderThread)                    │
├─────────────────────────────────────────────────────────────┤
│  AppShell.Update()                                          │
│      │                                                      │
│      ├── snapshot_provider_(snapshot_[current_])  // fetch  │
│      ├── current_screen_->OnUpdate(snapshot_[current_])     │
│      └── current_ ^= 1  // swap buffer index                │
└─────────────────────────────────────────────────────────────┘
```

**Key patterns:**
- **Double-buffer**: AppShell holds two `AppStateSnapshot` instances, alternates each frame
- **Provider function**: `void(*)(AppStateSnapshot&)` decouples UI from AppState
- **Pass-by-reference**: Snapshot passed to `OnUpdate()`, no per-screen copies

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Thread safety | `pw::sync::Mutex` | Idiomatic Pigweed; compile-time safety via `PW_GUARDED_BY` |
| Read pattern | Snapshot by value | Tiny critical section (~μs); no dangling references |
| FSM type | Placeholder for now | NoTag/HasTag with UID to validate threading; real HFSM designed later |
| UI notification | Poll in OnUpdate() | Follows existing Watched<T> pattern |
| Module location | `modules/app_state/` | Follows existing module organization |
| Snapshot delivery | Pass to OnUpdate() | Single fetch per frame, no per-screen overhead |
| Navigator rename | → AppShell | Reflects expanded responsibility (state + navigation) |
| Double-buffer | Two snapshots in AppShell | Allows safe reference passing, no allocation per frame |

## Files to Create

### 1. `modules/app_state/app_state.h`
Thread-safe public interface:

```cpp
#pragma once
#include <array>
#include "pw_sync/mutex.h"
#include "pw_sync/lock_annotations.h"
#include "state_id.h"

namespace maco::app_state {

// Maximum tag UID size (NTAG424 uses 7 bytes, but allow for other tags)
inline constexpr size_t kMaxTagUidSize = 10;

// Tag UID with size (value type, safe to copy)
struct TagUid {
  std::array<std::byte, kMaxTagUidSize> bytes{};
  size_t size = 0;

  bool empty() const { return size == 0; }
};

// Snapshot for UI thread - copied by value, no dangling references
struct AppStateSnapshot {
  AppStateId state = AppStateId::kNoTag;
  TagUid tag_uid;  // Valid when state == kHasTag
};

class AppState {
 public:
  // Thread-safe reads (can be called from UI thread)
  // Updates `out` in place under lock - no allocation
  void GetSnapshot(AppStateSnapshot& out) const PW_LOCKS_EXCLUDED(mutex_);

  // State transitions (main thread only, called by NfcReader task)
  void OnTagDetected(pw::ConstByteSpan uid);
  void OnTagRemoved();

 private:
  mutable pw::sync::Mutex mutex_;
  AppStateId state_ PW_GUARDED_BY(mutex_) = AppStateId::kNoTag;
  TagUid tag_uid_ PW_GUARDED_BY(mutex_);
};

}  // namespace maco::app_state
```

### 2. `modules/app_state/state_id.h`
**Placeholder FSM** (validates threading pattern; real HFSM designed separately):

```cpp
#pragma once

namespace maco::app_state {

// Placeholder states - replace with real HFSM later
enum class AppStateId {
  kNoTag,   // No tag present
  kHasTag,  // Tag detected (UID available in snapshot)
};

// Events (used internally, not exposed to UI)
enum class EventId {
  kTagDetected,  // NFC reader detected a tag
  kTagRemoved,   // NFC reader lost tag
};

}  // namespace maco::app_state
```

### 3. `modules/app_state/BUILD.bazel`

```python
cc_library(
    name = "app_state",
    srcs = ["app_state.cc"],
    hdrs = ["state_id.h", "app_state.h"],
    deps = [
        "@pigweed//pw_sync:mutex",
        "@pigweed//pw_sync:lock_annotations",
        "@pigweed//pw_chrono:system_clock",
        "@pigweed//pw_string:string",
        # ETL added later when real HFSM is implemented
    ],
)
```

### 4. `system/system.h` addition

```cpp
namespace maco::system {
  maco::app_state::AppState& GetAppState();
}
```

## Files to Modify

### 1. `modules/ui/navigator.h` → `modules/ui/app_shell.h`

Rename Navigator to AppShell, add snapshot management:

```cpp
#pragma once
#include "maco_firmware/modules/app_state/app_state.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/ui/screen.h"
// ... other includes

namespace maco::ui {

/// Snapshot provider function type - fills snapshot by reference
using SnapshotProvider = void (*)(app_state::AppStateSnapshot&);

/// AppShell manages screens, chrome, and state propagation.
///
/// Responsibilities:
///   - Screen navigation (push/pop/replace/reset)
///   - Screen lifecycle management
///   - Button bar chrome
///   - **App state snapshot delivery to screens**
class AppShell {
 public:
  static constexpr size_t kMaxNavigationDepth = 6;

  /// Constructor with snapshot provider for testability.
  AppShell(display::Display& display, SnapshotProvider snapshot_provider);
  ~AppShell();

  // ... Init(), Push(), Pop(), Replace(), Reset() unchanged ...

  /// Called once per frame. Fetches snapshot, updates screen.
  void Update();

 private:
  // ... existing members ...

  // Double-buffered snapshots
  SnapshotProvider snapshot_provider_;
  app_state::AppStateSnapshot snapshots_[2];
  size_t current_snapshot_ = 0;
};

}  // namespace maco::ui
```

### 2. `modules/ui/screen.h`

Update `OnUpdate()` signature to receive snapshot:

```cpp
class Screen {
 public:
  // ... existing methods ...

  /// Called each frame with current app state snapshot.
  virtual void OnUpdate(const app_state::AppStateSnapshot& snapshot) = 0;
};
```

## Placeholder State Machine

Simple two-state FSM to validate threading pattern:

```
┌────────┐  TagDetected(uid)  ┌────────┐
│ NoTag  │ ──────────────────> │ HasTag │
└────────┘ <────────────────── └────────┘
              TagRemoved
```

**Note:** Real HFSM (per ADR-0010) will be designed in a follow-up task.

## UI Integration Pattern

AppShell fetches snapshot once per frame and passes to screen:

```cpp
// In AppShell::Update()
void AppShell::Update() {
  // Fetch into current buffer
  snapshot_provider_(snapshots_[current_snapshot_]);

  // Pass to screen
  if (auto* screen = current_screen()) {
    screen->OnUpdate(snapshots_[current_snapshot_]);
  }

  // Swap buffer for next frame
  current_snapshot_ ^= 1;

  UpdateChrome();
}
```

Screen receives snapshot by const reference:

```cpp
void NfcTestScreen::OnUpdate(const app_state::AppStateSnapshot& snapshot) {
  state_watched_.Set(snapshot.state);

  if (state_watched_.CheckAndClearDirty()) {
    UpdateStatusText(snapshot);
    if (status_label_) {
      lv_label_set_text(status_label_, status_text_.c_str());
    }
  }
}
```

### `apps/dev/screens/nfc_test_screen.h`

**Current:** Takes `NfcReader&` and reads directly (cross-thread)
**New:** No dependencies - receives snapshot via `OnUpdate()`

```cpp
#pragma once
#include "maco_firmware/modules/app_state/app_state.h"
#include "maco_firmware/modules/ui/data_binding.h"
#include "maco_firmware/modules/ui/screen.h"
#include "pw_string/string_builder.h"

namespace maco::dev {

class NfcTestScreen : public ui::Screen {
 public:
  NfcTestScreen();  // No dependencies!

  pw::Status OnActivate() override;
  void OnDeactivate() override;
  void OnUpdate(const app_state::AppStateSnapshot& snapshot) override;
  ui::ButtonConfig GetButtonConfig() const override;

 private:
  void UpdateStatusText(const app_state::AppStateSnapshot& snapshot);
  static void FormatUidTo(pw::StringBuilder& out, const app_state::TagUid& uid);

  lv_obj_t* status_label_ = nullptr;

  // Watched state for dirty checking
  ui::Watched<app_state::AppStateId> state_watched_{app_state::AppStateId::kNoTag};
  pw::StringBuffer<64> status_text_;
};

}  // namespace maco::dev
```

### `apps/dev/screens/nfc_test_screen.cc`

Key changes:
1. Constructor takes no parameters - screen is stateless regarding app state
2. `OnUpdate()` receives snapshot from AppShell
3. No cross-thread access, no stored references

```cpp
NfcTestScreen::NfcTestScreen() : Screen("NfcTest") {
  status_text_ << "No card";
}

void NfcTestScreen::OnUpdate(const app_state::AppStateSnapshot& snapshot) {
  state_watched_.Set(snapshot.state);

  if (state_watched_.CheckAndClearDirty()) {
    UpdateStatusText(snapshot);
    if (status_label_) {
      lv_label_set_text(status_label_, status_text_.c_str());
    }
  }
}

void NfcTestScreen::UpdateStatusText(const app_state::AppStateSnapshot& snapshot) {
  status_text_.clear();
  if (snapshot.state == app_state::AppStateId::kHasTag) {
    status_text_ << "Card: ";
    FormatUidTo(status_text_, snapshot.tag_uid);
  } else {
    status_text_ << "No card";
  }
}

void NfcTestScreen::FormatUidTo(pw::StringBuilder& out, const app_state::TagUid& uid) {
  for (size_t i = 0; i < uid.size; i++) {
    if (i > 0) out << ':';
    out.Format("%02X", static_cast<unsigned>(uid.bytes[i]));
  }
}
```

### Event Flow: NfcReader → AppState

The NfcReader task (main thread) calls AppState methods when tag status changes:

```cpp
// In NfcReader task (main thread) - conceptual
void NfcReaderTask::OnTagDetected(pw::ConstByteSpan uid) {
  system::GetAppState().OnTagDetected(uid);
}

void NfcReaderTask::OnTagRemoved() {
  system::GetAppState().OnTagRemoved();
}
```

**Note:** Exact integration with NfcReader is out of scope - this plan establishes the interface.

## Implementation Tasks

### Phase 0: Document the plan
- [x] Copy this plan to `docs/plans/app-state-threading.md`

### Phase 1: Create app_state module
- [x] Create `modules/app_state/` directory
- [x] Implement `state_id.h` - NoTag/HasTag state enums
- [x] Implement `app_state.h` - Thread-safe API with `PW_GUARDED_BY`, `GetSnapshot(out&)`
- [x] Implement `app_state.cc` - Mutex-protected state + OnTagDetected/OnTagRemoved
- [x] Create `BUILD.bazel` for app_state module
- [x] Create `app_state_test.cc` - Unit tests for thread-safe reads/writes

### Phase 2: System integration
- [x] Add `GetAppState()` to `system/system.h`
- [x] Implement in `targets/host/system.cc`
- [x] Implement in `targets/p2/system.cc`

### Phase 3: Navigator → AppShell refactor
- [x] Rename `navigator.h` → `app_shell.h`, `Navigator` → `AppShell`
- [x] Add `SnapshotProvider` typedef and constructor parameter
- [x] Add double-buffered `snapshots_[2]` and `current_snapshot_` index
- [x] Update `Update()` to fetch snapshot and pass to screen
- [x] Update `Screen::OnUpdate()` signature to take `const AppStateSnapshot&`
- [x] Update all existing screens to match new signature
- [x] Update BUILD.bazel dependencies

### Phase 4: Validate with NfcTestScreen
- [x] Update `nfc_test_screen.h` - Remove NfcReader dependency, add Watched<T>
- [x] Update `nfc_test_screen.cc` - Receive snapshot via OnUpdate()
- [x] Update call sites that construct NfcTestScreen (no more NfcReader param)

### Out of Scope (follow-up tasks)

- **HFSM Design**: Design real hierarchical states (per ADR-0010)
- **NfcReader Integration**: Hook NfcReader task to call `OnTagDetected`/`OnTagRemoved`
- **Full Event Routing**: AppController to route all events to FSM

## Verification

1. **Build**: `./pw build host && ./pw build p2`
2. **Unit tests**: `bazel test //maco_firmware/modules/app_state:app_state_test`
3. **Thread safety**: Clang thread safety analysis via `PW_GUARDED_BY` annotations
4. **Manual test (simulator)**:
   - Run simulator with NfcTestScreen
   - Verify "No card" displayed initially
   - Call `GetAppState().OnTagDetected(...)` from main thread
   - Verify UI updates to show tag UID
   - Call `GetAppState().OnTagRemoved()`
   - Verify UI returns to "No card"

## Reference Files

- `system/system.h` - Global factory pattern (GetNfcReader, GetDisplayDriver)
- `targets/host/system.cc` - Host implementation of system factories
- `targets/p2/system.cc` - P2 implementation of system factories
- `modules/ui/navigator.h` - **Renamed to app_shell.h**
- `modules/ui/navigator.cc` - **Renamed to app_shell.cc**
- `modules/ui/screen.h` - Screen base class (OnUpdate signature change)
- `modules/ui/data_binding.h` - Watched<T> pattern for UI
- `modules/display/display.h` - UI thread implementation (RenderThread)
- `third_party/particle/pw_sync_particle/` - Mutex backend for P2
- `apps/dev/screens/nfc_test_screen.h` - Screen to modify for validation
- `apps/dev/screens/nfc_test_screen.cc` - Current implementation with cross-thread access

## Implementation Notes (Post-Implementation)

### Module Structure Refinement

The snapshot types were moved to their own target for cleaner dependencies:

```
modules/app_state/
├── state_id.h           # State enum (kNoTag, kHasTag)
├── app_state.h/cc       # Thread-safe AppState (main thread writer)
├── BUILD.bazel
└── ui/
    ├── snapshot.h       # AppStateSnapshot, TagUid (UI read-only view)
    └── BUILD.bazel
```

**Dependency direction:**
- `ui:snapshot` - Standalone, UI-facing types (no mutex dependencies)
- `app_state` - Depends on `ui:snapshot`, adds thread-safe write methods
- `screen` / screens - Depend only on `ui:snapshot` (read-only)
- `app_shell` / `main.cc` - Depend on full `app_state` (need `GetSnapshot()`)
