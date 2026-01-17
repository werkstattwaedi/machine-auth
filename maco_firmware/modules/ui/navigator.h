// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>

#include "lvgl.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/ui/screen.h"
#include "pw_containers/vector.h"
#include "pw_status/status.h"

namespace maco::ui {

class ButtonBar;

/// Navigator manages the screen stack and UI chrome.
///
/// Responsibilities:
///   - Screen navigation (push/pop/replace/reset)
///   - Screen lifecycle management
///   - Button bar chrome (persistent on lv_layer_top)
///   - Update propagation to current screen
///
/// Usage:
///   Navigator navigator(display);
///   navigator.Init();
///   navigator.Reset(std::make_unique<HomeScreen>(navigator, deps...));
class Navigator {
 public:
  static constexpr size_t kMaxNavigationDepth = 6;

  /// Constructor with dependency injection (per ADR-0001).
  explicit Navigator(display::Display& display);
  ~Navigator();

  // Non-copyable, non-movable
  Navigator(const Navigator&) = delete;
  Navigator& operator=(const Navigator&) = delete;

  /// Initialize chrome widgets (button bar on lv_layer_top).
  /// Must be called before any navigation.
  pw::Status Init();

  /// Push a new screen onto the stack.
  /// @param screen Screen to push (takes ownership).
  pw::Status Push(std::unique_ptr<Screen> screen);

  /// Pop the current screen and return to previous.
  /// Does nothing if only one screen on stack.
  pw::Status Pop();

  /// Replace the current screen with a new one.
  /// @param screen Screen to replace with (takes ownership).
  pw::Status Replace(std::unique_ptr<Screen> screen);

  /// Clear the stack and set a new root screen.
  /// @param screen New root screen (takes ownership).
  pw::Status Reset(std::unique_ptr<Screen> screen);

  /// Called once per frame from Display callback.
  /// Updates chrome and propagates to current screen.
  void Update();

  /// Get the current active screen (top of stack).
  /// @return Current screen or nullptr if stack is empty.
  Screen* current_screen() const;

 private:
  void ActivateScreen(Screen* screen);
  void DeactivateScreen(Screen* screen);
  void UpdateChrome();
  void HandleEscapeKey();

  display::Display& display_;
  pw::Vector<std::unique_ptr<Screen>, kMaxNavigationDepth> stack_;

  // Chrome widgets (persistent on lv_layer_top)
  std::unique_ptr<ButtonBar> button_bar_;

  // Currently active input group
  lv_group_t* active_group_ = nullptr;
};

}  // namespace maco::ui
