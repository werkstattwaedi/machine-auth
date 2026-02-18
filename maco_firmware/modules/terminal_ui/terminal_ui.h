// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>

#include "maco_firmware/modules/app_state/session_controller.h"
#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/status_bar/status_bar.h"
#include "maco_firmware/modules/terminal_ui/ui_action.h"
#include "maco_firmware/modules/ui/app_shell.h"
#include "pw_status/status.h"

namespace maco::terminal_ui {

/// Coordinates the terminal UI: manages screen transitions and bridges
/// user actions to SessionController.
///
/// Owns the AppShell and StatusBar. Manages the lifecycle:
///   SplashScreen -> MainScreen (root) -> MenuScreen (overlay)
///
/// Call SetController() once the system is ready. This ends the splash
/// screen and transitions to the main UI.
class TerminalUi {
 public:
  /// Registers the display init callback. Construct before display.Init().
  explicit TerminalUi(display::Display& display);

  /// Set the session controller and signal that the system is ready.
  /// Ends the splash screen and transitions to MainScreen.
  /// May be called with nullptr (e.g. device not provisioned).
  /// Thread-safe: called from main thread, consumed on render thread.
  void SetController(app_state::SessionController* controller);

 private:
  pw::Status Init();
  void HandleAction(UiAction action);
  void TransitionToMain();

  display::Display& display_;
  app_state::SessionController* controller_ = nullptr;

  status_bar::StatusBar status_bar_;
  ui::AppShell<app_state::AppStateSnapshot> app_shell_;

  std::atomic<bool> ready_{false};
  bool in_splash_ = false;
};

}  // namespace maco::terminal_ui
