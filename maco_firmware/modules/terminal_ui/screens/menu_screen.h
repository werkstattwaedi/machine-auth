// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <string_view>

#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/modules/terminal_ui/ui_action.h"
#include "maco_firmware/modules/ui/screen.h"
#include "pw_containers/vector.h"

namespace maco::terminal_ui {

/// Menu item with label and associated action.
struct MenuItem {
  std::string_view label;
  UiAction action;
};

/// Overlay screen showing a list of menu items.
/// Navigated with Up/Down keys, selected with OK, dismissed with ESC.
class MenuScreen : public ui::Screen<app_state::AppStateSnapshot> {
 public:
  static constexpr size_t kMaxMenuItems = 8;

  MenuScreen(pw::span<const MenuItem> items, ActionCallback action_callback);

  pw::Status OnActivate() override;
  void OnDeactivate() override;
  ui::ButtonConfig GetButtonConfig() const override;

 private:
  pw::Vector<MenuItem, kMaxMenuItems> items_;
  ActionCallback action_callback_;

  lv_obj_t* list_ = nullptr;
};

}  // namespace maco::terminal_ui
