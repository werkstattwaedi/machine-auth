# UI Framework Module Plan

## Overview

Build a modular UI framework for maco_firmware using LVGL, enabling screen-based navigation with efficient updates and physical button handling.

**Display**: 240x320 pixels (portrait)
**Input**: 4 physical touch buttons positioned alongside display (2 top, 2 bottom)
**Button LEDs**: Illumination color per button to connect with UI elements

## Key Design Decisions

### 1. Screen Architecture: Constructor Dependency Injection (per ADR-0001)

- **Dependencies injected via constructor** - Follows project's established pattern
- **ScreenManager owns screens** - Uses `std::unique_ptr<Screen>` for ownership
- **Factory or direct construction** - Screens created with explicit dependencies
- **Use `lv_screen_load()`** - LVGL's native screen management with animations
- **Lifecycle hooks**: `OnActivate()`, `OnDeactivate()`, `OnUpdate()` for clean state management
- **Testable**: Dependencies can be mocked for unit tests

### 2. Efficient Updates: Dirty-Flag Pattern

The old implementation was slow because it updated LVGL widgets every tick. Solution:

```cpp
template <typename T>
class Watched {
  T value_;
  bool dirty_;
public:
  void Set(T new_value);       // Only marks dirty if changed
  bool CheckAndClearDirty();   // Atomic check-and-clear
};
```

Screens only call `lv_label_set_text()` etc. when data actually changed.

### 3. Physical Button Handling

4 buttons mapped to LVGL keypad input:
- **Top-left**: Up (LV_KEY_UP)
- **Top-right**: Down (LV_KEY_DOWN)
- **Bottom-left**: Cancel/Back (LV_KEY_ESC)
- **Bottom-right**: OK/Select (LV_KEY_ENTER)

Screens provide **ButtonSpec** describing:
- Label text (shown on-screen near button position)
- LED color (RGB for illumination)
- Whether button is active in current context

### 4. Persistent Chrome via LVGL Layers

Use `lv_layer_top()` for status bar that persists across all screen transitions.

## Module Structure

**Architecture layers:**
```
Display (existing)     → LVGL lifecycle, render thread, hardware plumbing
Navigator (new)        → Screen stack, lifecycle, button dispatch, chrome
Screen (new)           → Content rendering, button handlers
```

**Core UI framework** (reusable infrastructure):
```
maco_firmware/modules/ui/
├── BUILD.bazel
├── screen.h              # Base Screen interface
├── navigator.h/cc        # Navigation stack, button dispatch, chrome
├── button_spec.h         # Button configuration structs
├── data_binding.h        # Watched<T> dirty-flag template
└── widgets/
    ├── BUILD.bazel
    ├── status_bar.h/cc   # Top bar (machine name, status icons)
    ├── button_bar.h/cc   # Button labels display
    └── menu_list.h/cc    # Scrollable menu widget
```

**Screens as separate modules** (can be in own BUILD target or grouped):
```
maco_firmware/modules/ui/screens/
├── BUILD.bazel           # Screen targets
├── splash_screen.h/cc    # Boot splash
├── home_screen.h/cc      # Main idle screen
├── menu_screen.h/cc      # Settings menu
└── session_screen.h/cc   # Active session display
```

**Wiring happens in system.cc** (following existing pattern):
- Screens created with dependencies via constructor injection
- ScreenManager owns screens via `std::unique_ptr`
- No static singletons - clean testable architecture

## Core Interfaces

### Button Specification

```cpp
// modules/ui/button_spec.h
#include <string_view>

namespace maco::ui {

struct ButtonSpec {
  std::string_view label;          // On-screen label (empty = hidden)
  uint32_t led_color = 0x000000;   // RGB for button LED
};

// Bottom row buttons only - top row has engraved icons (no on-screen labels)
struct ButtonConfig {
  ButtonSpec cancel;   // Bottom-left button
  ButtonSpec ok;       // Bottom-right button
};

}  // namespace maco::ui
```

Top row buttons (Up/Down) have engraved icons on the physical buttons - no on-screen representation needed.

### Screen Base Class

```cpp
// modules/ui/screen.h
#include <string_view>

namespace maco::ui {

class Screen {
 public:
  explicit Screen(std::string_view debug_name) : debug_name_(debug_name) {}
  virtual ~Screen() = default;

  // Lifecycle - called by Navigator
  virtual pw::Status OnActivate() { return pw::OkStatus(); }
  virtual void OnDeactivate() {}
  virtual void OnUpdate() {}

  // Button labels for bottom row (Cancel/OK) - top row has engraved icons
  virtual ButtonConfig GetButtonConfig() const { return {}; }

  // Override to handle ESC differently (e.g., dismiss popup before pop)
  // Return true if handled, false to let Navigator pop the screen
  virtual bool OnEscapePressed() { return false; }

  // LVGL screen object and input group
  lv_obj_t* lv_screen() const { return lv_screen_; }
  lv_group_t* lv_group() const { return lv_group_; }
  std::string_view debug_name() const { return debug_name_; }

 protected:
  // Dirty flag pattern for efficient updates
  void MarkDirty() { dirty_ = true; }
  bool CheckAndClearDirty() {
    if (dirty_) { dirty_ = false; return true; }
    return false;
  }

  // Add widget to this screen's input group (for keypad navigation)
  void AddToGroup(lv_obj_t* widget) {
    if (lv_group_) lv_group_add_obj(lv_group_, widget);
  }

  lv_obj_t* lv_screen_ = nullptr;   // LVGL screen object
  lv_group_t* lv_group_ = nullptr;  // Input group for keypad navigation

 private:
  std::string_view debug_name_;
  bool dirty_ = true;
};

}  // namespace maco::ui
```

**LVGL group setup**: Screens create `lv_group_t` in OnActivate(), add focusable widgets via `AddToGroup()`. Navigator sets the active group when switching screens. LVGL handles Up/Down/Enter automatically.

**String handling guidelines** (per Pigweed patterns):
- `std::string_view` for parameters, return values, non-owning references
- `pw::InlineString<N>` for owned strings that need modification
- `const char*` only at C API boundaries (LVGL callbacks)

### Navigator

**Single class for UI shell** - navigation stack and chrome coordination:

```cpp
// modules/ui/navigator.h
#include <memory>
#include "pw_containers/vector.h"

namespace maco::ui {

class Navigator {
 public:
  static constexpr size_t kMaxNavigationDepth = 6;

  // Dependencies injected via constructor (per ADR-0001)
  explicit Navigator(display::Display& display);

  // Initialize chrome (status bar, button bar on lv_layer_top)
  pw::Status Init();

  // Navigation - takes ownership of screens
  pw::Status Push(std::unique_ptr<Screen> screen);
  pw::Status Pop();                              // Go back (ESC default)
  pw::Status Replace(std::unique_ptr<Screen> screen);
  pw::Status Reset(std::unique_ptr<Screen> screen);  // Clear stack

  // Called once per frame from Display callback
  void Update();

  // Current state
  Screen* current_screen() const;

 private:
  void UpdateChrome();  // Sync button labels from current screen
  void HandleEscapeKey();  // Called by LVGL key event

  display::Display& display_;
  pw::Vector<std::unique_ptr<Screen>, kMaxNavigationDepth> stack_;

  // Chrome widgets (on lv_layer_top, persistent)
  StatusBar* status_bar_ = nullptr;    // Owned separately, observes FSM
  std::optional<ButtonBar> button_bar_;
};

}  // namespace maco::ui
```

**No HandleButtonUp/Down/Ok** - LVGL groups handle focus navigation and Enter clicks automatically. Navigator only handles ESC for stack navigation.

**Screens use constructor dependency injection:**

```cpp
// modules/ui/screens/home_screen.h (separate module)
class HomeScreen : public Screen {
 public:
  // Dependencies injected via constructor (per ADR-0001)
  HomeScreen(Navigator& navigator, SessionService& sessions)
      : Screen("Home"),  // string_view from literal - static lifetime OK
        navigator_(navigator),
        sessions_(sessions) {}

  bool OnOkPressed() override {
    // Create and push new screen with its dependencies
    navigator_.Push(
        std::make_unique<MenuScreen>(navigator_, settings_));
    return true;
  }

 private:
  Navigator& navigator_;
  SessionService& sessions_;
};
```

**Wiring in system.cc** (following existing pattern):

```cpp
// targets/p2/system.cc
Navigator& GetNavigator() {
  static auto& display = GetDisplay();
  static Navigator navigator(display);
  return navigator;
}

void InitializeUI() {
  auto& navigator = GetNavigator();
  auto& sessions = GetSessionService();

  navigator.Init();  // Create chrome

  // Create initial screen with dependencies
  navigator.Reset(
      std::make_unique<HomeScreen>(navigator, sessions));
}
```

**Benefits:**
- Single class for UI shell (no UiManager vs ScreenManager confusion)
- Follows ADR-0001 (constructor dependency injection)
- Clear responsibilities: Display=plumbing, Navigator=shell, Screen=content
- Testable: mock Display and dependencies

### Watched Data Binding

```cpp
// modules/ui/data_binding.h
namespace maco::ui {

template <typename T>
class Watched {
 public:
  explicit Watched(T initial) : value_(std::move(initial)), dirty_(true) {}

  void Set(T new_value) {
    if (value_ != new_value) {
      value_ = std::move(new_value);
      dirty_ = true;
    }
  }

  const T& Get() const { return value_; }

  bool CheckAndClearDirty() {
    if (dirty_) { dirty_ = false; return true; }
    return false;
  }

 private:
  T value_;
  bool dirty_;
};

}  // namespace maco::ui
```

## Widgets

### StatusBar (Separate module - `modules/status_bar/`)

- **Own module** - not part of Navigator
- Observes system state FSM (to be defined separately)
- Content TBD - placeholder bar at top for now
- Height: ~40px, full width
- Lives on `lv_layer_top()` (persistent across screens)

```cpp
// modules/status_bar/status_bar.h
class StatusBar {
 public:
  StatusBar();  // Will take FSM observer interface later

  pw::Status Init();  // Creates LVGL widgets on lv_layer_top()
  void Update();      // Updates display from observed state

 private:
  lv_obj_t* container_ = nullptr;
  // Content TBD - will observe FSM for system state
};
```

### ButtonBar (Bottom row labels only)

- Shows labels for **bottom row only** (Cancel/OK)
- Top row buttons have engraved icons - no on-screen display
- Height: ~50px at bottom edge
- Updates LED colors via system interface (TBD)

```cpp
// modules/ui/widgets/button_bar.h
class ButtonBar {
 public:
  explicit ButtonBar(lv_obj_t* parent);

  void SetConfig(const ButtonConfig& config);
  void Update();  // Update display if config changed

 private:
  lv_obj_t* cancel_label_;  // Bottom-left
  lv_obj_t* ok_label_;      // Bottom-right

  Watched<ButtonConfig> config_;
};
```

### MenuList (Scrollable, keyboard-navigable)

- Uses `lv_list` - LVGL handles focus via groups
- Items navigated with Up/Down (via LVGL group)
- Enter triggers item callback (via LVGL event)
- Automatic highlight of focused item

```cpp
// modules/ui/widgets/menu_list.h
class MenuList {
 public:
  explicit MenuList(lv_obj_t* parent, lv_group_t* group);

  void AddItem(std::string_view text, std::function<void()> on_select);
  void Clear();

 private:
  lv_obj_t* list_;
  lv_group_t* group_;  // Owned by Screen, passed in
};
```

Note: MenuList doesn't own the group - Screen owns it and passes it in. This allows multiple widgets on a screen to share the same focus group.

## Integration with Display

The existing `Display` class in `modules/display/` handles LVGL lifecycle and render thread.
The new `Navigator` sits on top, managing screens and chrome:

```
┌─────────────────────────────────────────────────────────┐
│  Application code                                       │
│    - Creates screens with dependencies                  │
│    - Calls navigator.Push/Pop/Reset                     │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Navigator (modules/ui/)                                │
│    - Owns screen stack (unique_ptr)                     │
│    - Manages chrome (StatusBar, ButtonBar)              │
│    - Dispatches buttons to current screen               │
│    - Update() called once per frame                     │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Display (modules/display/)                             │
│    - LVGL init, tick, delay callbacks                   │
│    - Display driver + touch driver                      │
│    - Render thread calls callback before lv_timer_handler │
└─────────────────────────────────────────────────────────┘
```

### Display Callback (modification to existing Display class)

Display needs a pre-render callback to trigger Navigator::Update() exactly once per frame:

```cpp
// modules/display/display.h (modified)
class Display {
 public:
  using UpdateCallback = pw::Function<void()>;

  // Set callback called once per frame before lv_timer_handler()
  void SetUpdateCallback(UpdateCallback callback) {
    update_callback_ = std::move(callback);
  }

 private:
  void RenderThread() {
    while (running_.load()) {
      if (update_callback_) update_callback_();  // <-- Before render
      uint32_t time_till_next = lv_timer_handler();
      pw::this_thread::sleep_for(std::chrono::milliseconds(time_till_next));
    }
  }

  UpdateCallback update_callback_;
};
```

### Update Propagation (tree walking)

Each UI component has `Update()` that:
1. Checks dirty flags
2. Updates LVGL widgets if dirty
3. Calls children's `Update()`

```
Navigator::Update()
├── status_bar_.Update()      // Updates LVGL labels if data changed
├── button_bar_.Update()      // Updates button labels if config changed
└── current_screen->OnUpdate()
    └── (screen updates its content)
        ├── menu_list_.Update()
        └── (other widgets...)
```

Screens override `OnUpdate()` to update their widgets:

```cpp
void HomeScreen::OnUpdate() {
  // Update our widgets
  if (session_info_.CheckAndClearDirty()) {
    lv_label_set_text(session_label_, session_info_.Get().c_str());
  }

  // Propagate to child widgets
  menu_list_.Update();
}
```

Navigator receives `Display&` via constructor (ADR-0001) and registers callback in Init().

## Files to Create/Modify

### Display Modification (existing file)

| File | Change |
|------|--------|
| `modules/display/display.h` | Add `SetUpdateCallback()` |
| `modules/display/display.cc` | Call callback before `lv_timer_handler()` |

### Core UI Framework (Phase 1)

| File | Purpose |
|------|---------|
| `modules/ui/BUILD.bazel` | Core UI library build |
| `modules/ui/button_spec.h` | ButtonSpec and ButtonConfig structs |
| `modules/ui/screen.h` | Base Screen interface |
| `modules/ui/navigator.h` | Navigator interface |
| `modules/ui/navigator.cc` | Navigation stack, button dispatch, chrome |
| `modules/ui/data_binding.h` | Watched<T> template |

### StatusBar Module (Phase 1)

| File | Purpose |
|------|---------|
| `modules/status_bar/BUILD.bazel` | StatusBar module build |
| `modules/status_bar/status_bar.h` | StatusBar interface |
| `modules/status_bar/status_bar.cc` | StatusBar implementation (placeholder) |

### UI Widgets (Phase 1)

| File | Purpose |
|------|---------|
| `modules/ui/widgets/BUILD.bazel` | Widget library build |
| `modules/ui/widgets/button_bar.h/cc` | Bottom row button labels |
| `modules/ui/widgets/menu_list.h/cc` | Keyboard-navigable menu |

### Example Screens (Phase 2 - separate modules)

| File | Purpose |
|------|---------|
| `modules/ui/screens/BUILD.bazel` | Screen targets |
| `modules/ui/screens/home_screen.h/cc` | Main idle screen |
| `modules/ui/screens/menu_screen.h/cc` | Settings menu |

Screens are added as separate BUILD targets - no changes to core UI needed.

## ADR Compliance

This design follows documented architecture decisions:

- **ADR-0001**: Constructor Dependency Injection - screens receive deps via constructor
- **ADR-0003**: Hardware Abstraction Layer - display/input abstracted
- **ADR-0004**: Display Driver Architecture - integrates with existing DisplayManager

## Legacy Patterns to Adopt

From the legacy `firmware/src/ui`:

1. **State-driven rendering** - Screens re-render on state changes, not every tick
2. **Button spec pattern** - Dynamic button configuration per screen state
3. **Chrome visibility control** - Screens can hide/show status bar via GetButtonConfig()
4. **Screen lifecycle hooks** - OnActivate/OnDeactivate for setup/cleanup
5. **LED effects integration** - Button colors reflect current action context

## Screen Layout

```
┌─────────────────────────────┐
│  [Up]              [Down]   │  ← Physical buttons (top row)
├─────────────────────────────┤
│         Status Bar          │  ← Persistent, ~40px
├─────────────────────────────┤
│                             │
│                             │
│        Screen Content       │  ← 240 x ~230px
│                             │
│                             │
├─────────────────────────────┤
│ [Cancel]              [OK]  │  ← Physical buttons (bottom row)
└─────────────────────────────┘
```

Button labels are displayed on-screen near the physical button positions.
Content area is the screen's responsibility; widgets like MenuList fit here.

## Verification

1. **Build**: `./pw build host` - Module compiles without errors
2. **Unit tests**: Create `screen_manager_test.cc` with mock screens
3. **Integration**: Create simple test screen with menu navigation
   - HomeScreen with MenuList
   - Up/Down navigates menu items
   - OK selects item
   - Cancel goes back
4. **Simulator**: Run `bazel run //maco_firmware/apps/dev:simulator` to verify visually
