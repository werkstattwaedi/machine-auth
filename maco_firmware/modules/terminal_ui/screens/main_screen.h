// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/modules/terminal_ui/screens/confirmation_overlay.h"
#include "maco_firmware/modules/terminal_ui/ui_action.h"
#include "maco_firmware/modules/ui/data_binding.h"
#include "maco_firmware/modules/ui/screen.h"
#include "pw_string/string.h"

namespace maco::terminal_ui {

/// Primary screen for the terminal with these visual states:
///   - Idle: white bg, machine name, "Mit Badge anmelden"
///   - Ready: yellow bg, session active but machine idle (e.g. laser not
///     cutting); user name + in-use timer
///   - Active: green bg, machine actually in use; user name + in-use timer
///   - Denied: red bg, cancel icon, "Nicht berechtigt"
///
/// Pending confirmations (checkout, takeover, stop) are shown as a
/// ConfirmationOverlay on top of the Active/Ready state.
class MainScreen : public ui::Screen<app_state::AppStateSnapshot> {
 public:
  explicit MainScreen(ActionCallback action_callback);

  pw::Status OnActivate() override;
  void OnDeactivate() override;
  void OnUpdate(const app_state::AppStateSnapshot& snapshot) override;
  bool OnEscapePressed() override;
  ui::ButtonConfig GetButtonConfig() const override;
  ui::ScreenStyle GetScreenStyle() const override;

 protected:
  // Exposed for screenshot/layout tests. LV_LABEL_LONG_MODE_DOTS rewrites the
  // label's own text buffer with the ellipsized string, so a test can read
  // these back to assert clamping fired without diffing pixels (issue #532).
  lv_obj_t* user_name_label_for_test() const { return user_name_label_; }
  lv_obj_t* machine_name_label_for_test() const { return machine_name_label_; }
  lv_obj_t* status_chip_for_test() const { return status_chip_; }

 private:
  enum class VisualState {
    kIdle,
    kReady,
    kActive,
    kDenied,
  };

  void SetVisualState(VisualState state);
  void HideAllWidgets();

  ActionCallback action_callback_;
  VisualState visual_state_ = VisualState::kIdle;
  ui::Watched<pw::InlineString<64>> machine_label_{pw::InlineString<64>()};

  // Idle widgets
  lv_obj_t* machine_name_label_ = nullptr;
  lv_obj_t* instruction_label_ = nullptr;
  lv_obj_t* menu_btn_ = nullptr;

  // Active/Ready widgets. session_column_ is a vertical flex container that
  // reflows the name, chip and timer to the (possibly two-line) name's height.
  lv_obj_t* session_column_ = nullptr;
  lv_obj_t* status_chip_ = nullptr;   // "Bereit" / "Pausiert" / "In Betrieb"
  lv_obj_t* status_label_ = nullptr;  // text inside the chip
  lv_obj_t* user_name_label_ = nullptr;
  lv_obj_t* timer_row_ = nullptr;  // clock icon + duration, toggled as a unit
  lv_obj_t* timer_icon_ = nullptr;
  lv_obj_t* timer_label_ = nullptr;

  // Denied widgets
  lv_obj_t* denied_icon_ = nullptr;
  lv_obj_t* denied_label_ = nullptr;

  // Pending confirmation overlay
  ConfirmationOverlay overlay_;

  void ConfigureMachineLabel(bool idle_mode);
};

}  // namespace maco::terminal_ui
