// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/modules/terminal_ui/ui_action.h"
#include "maco_firmware/modules/ui/screen.h"

namespace maco::terminal_ui {

/// Primary screen for the terminal. Currently shows idle mode with NFC prompt.
/// Future phases will add session states (scanning, active, checkout, etc.).
class MainScreen : public ui::Screen<app_state::AppStateSnapshot> {
 public:
  explicit MainScreen(ActionCallback action_callback);

  pw::Status OnActivate() override;
  void OnDeactivate() override;
  void OnUpdate(const app_state::AppStateSnapshot& snapshot) override;
  ui::ButtonConfig GetButtonConfig() const override;

 private:
  ActionCallback action_callback_;

  lv_obj_t* nfc_icon_ = nullptr;
  lv_obj_t* title_label_ = nullptr;
  lv_obj_t* instruction_label_ = nullptr;
};

}  // namespace maco::terminal_ui
