// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>

#include "lvgl.h"
#include "maco_firmware/modules/app_state/app_state.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/ui/screen.h"
#include "pw_containers/vector.h"
#include "pw_status/status.h"

namespace maco::ui {

class ButtonBar;

/// Snapshot provider function type - fills snapshot by reference.
using SnapshotProvider = void (*)(app_state::AppStateSnapshot&);

/// AppShell manages screens, chrome, and state propagation.
///
/// Responsibilities:
///   - Screen navigation (push/pop/replace/reset)
///   - Screen lifecycle management
///   - Button bar chrome (persistent on lv_layer_top)
///   - App state snapshot delivery to screens
///
/// Usage:
///   auto provider = [](auto& s) { system::GetAppState().GetSnapshot(s); };
///   AppShell shell(display, provider);
///   shell.Init();
///   shell.Reset(std::make_unique<HomeScreen>(shell, deps...));
class AppShell {
 public:
  static constexpr size_t kMaxNavigationDepth = 6;

  /// Constructor with dependency injection (per ADR-0001).
  /// @param display Display module for UI rendering
  /// @param snapshot_provider Function to fetch app state snapshot
  AppShell(display::Display& display, SnapshotProvider snapshot_provider);
  ~AppShell();

  // Non-copyable, non-movable
  AppShell(const AppShell&) = delete;
  AppShell& operator=(const AppShell&) = delete;

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
  /// Fetches snapshot and propagates to current screen.
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

  // Snapshot management
  SnapshotProvider snapshot_provider_;
  app_state::AppStateSnapshot snapshots_[2];
  size_t current_snapshot_ = 0;
};

}  // namespace maco::ui
