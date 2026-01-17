# ADR-0012: App State UI Threading Model

**Status:** Accepted

**Date:** 2026-01-17

**Applies to:** `maco_firmware/` (Pigweed + Bazel)

**Related:** ADR-0010 (State Machine Architecture)

## Context

The firmware has two threads with different responsibilities:

1. **Main thread** (pw_async2 dispatcher) - Runs async tasks including NfcReader, handles all state mutations
2. **UI thread** (LVGL render thread) - Runs at ~30fps, updates display widgets

The application state (managed by ETL HFSM per ADR-0010) lives on the main thread. The UI thread needs to read this state to update the display, creating a cross-thread access problem.

### Requirements

- UI must display current application state (tag detected, session active, etc.)
- No blocking the main thread during UI updates
- No data races or torn reads
- Minimal lock contention
- Support for polling-based dirty checking (existing `Watched<T>` pattern)

### Options Considered

| Approach | Lock Duration | Complexity | Memory |
|----------|---------------|------------|--------|
| **Snapshot copy** | ~μs (copy only) | Low | Extra snapshot per frame |
| Direct mutex access | Variable (UI work) | Low | None |
| Lock-free atomics | None | High | Requires careful design |
| Message queue | None | Medium | Queue buffer |

## Decision

Use **immutable snapshots** with mutex-protected copy-on-read:

```
Main Thread                          UI Thread
───────────                          ─────────
AppState                             AppShell
├─ mutex_                            ├─ snapshots_[2]  (double-buffered)
├─ state_                            └─ Update()
└─ tag_uid_                               │
     │                                    ▼
     │                          snapshot_provider_(snapshot)
     │                                    │
     └──────────────────────────────────►│ GetSnapshot(out)
                                          │   lock, copy, unlock
                                          ▼
                                    screen->OnUpdate(snapshot)
                                          │
                                    (LVGL widget updates)
```

### Implementation

**AppState** (main thread writer, any thread reader):
```cpp
class AppState {
 public:
  void GetSnapshot(AppStateSnapshot& out) const PW_LOCKS_EXCLUDED(mutex_);
  void OnTagDetected(pw::ConstByteSpan uid) PW_LOCKS_EXCLUDED(mutex_);
  void OnTagRemoved() PW_LOCKS_EXCLUDED(mutex_);

 private:
  mutable pw::sync::Mutex mutex_;
  AppStateId state_ PW_GUARDED_BY(mutex_);
  TagUid tag_uid_ PW_GUARDED_BY(mutex_);
};
```

**AppStateSnapshot** (immutable value type):
```cpp
struct AppStateSnapshot {
  AppStateId state = AppStateId::kNoTag;
  TagUid tag_uid;
};
```

**AppShell** (UI thread):
```cpp
void AppShell::Update() {
  // Fetch snapshot (brief lock)
  snapshot_provider_(snapshots_[current_snapshot_]);

  // Pass to screen (no lock held)
  screen->OnUpdate(snapshots_[current_snapshot_]);

  // Swap buffer
  current_snapshot_ ^= 1;
}
```

### Key Patterns

1. **Copy-on-read**: `GetSnapshot()` locks mutex, copies state, unlocks. Lock held only during memcpy (~μs).

2. **Double-buffered snapshots**: AppShell holds two snapshots, alternates each frame. Avoids allocation per frame.

3. **Provider function**: `SnapshotProvider` typedef decouples UI from AppState for testability.

4. **Pass-by-reference**: Snapshot passed to `OnUpdate()` by const reference. Screen must not store the reference.

5. **Clang thread safety**: `PW_GUARDED_BY` and `PW_LOCKS_EXCLUDED` enable compile-time verification.

### Module Structure

```
modules/app_state/
├── state_id.h           # State enum (kNoTag, kHasTag)
├── app_state.h/cc       # Thread-safe AppState (mutex owner)
└── ui/
    └── snapshot.h       # AppStateSnapshot (UI-facing, no mutex)
```

The `ui/snapshot` target has no mutex dependencies, making the dependency direction clear:
- Screens depend on `ui:snapshot` (read-only view)
- `app_state` depends on `ui:snapshot` (defines the types it protects)

## Consequences

**Pros:**

- **Minimal lock contention** - Lock held only during copy (~μs), not during LVGL widget updates
- **Thread-safe by construction** - Snapshot is immutable value type, no dangling references
- **Compile-time verification** - Clang thread safety annotations catch errors at build time
- **Testable** - Provider function allows injecting test snapshots
- **Consistent state** - Each frame sees atomic snapshot, no torn reads

**Cons:**

- **Memory overhead** - Two AppStateSnapshot instances in AppShell
- **Stale data possible** - Snapshot may be one frame behind main thread state

**Tradeoffs:**

- **Rejected direct mutex access** - Would hold lock during LVGL work (variable duration, potential priority inversion)
- **Rejected lock-free atomics** - Complex to implement correctly, overkill for current state size
- **Rejected message queue** - More complex, higher memory usage, not needed for polling-based UI
