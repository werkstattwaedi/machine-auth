// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <string_view>

#include "lvgl.h"
#include "maco_firmware/modules/ui/button_spec.h"
#include "pw_status/status.h"

namespace maco::ui {

/// Base class for all UI screens.
///
/// Screens are owned by Navigator via std::unique_ptr. Dependencies are
/// injected via constructor (per ADR-0001).
///
/// Lifecycle:
///   1. Construction - Screen created with dependencies
///   2. OnActivate() - Called when screen becomes visible (create LVGL widgets)
///   3. OnUpdate() - Called once per frame while active
///   4. OnDeactivate() - Called when navigating away
///   5. Destruction - Screen popped from stack
class Screen {
 public:
  explicit Screen(std::string_view debug_name) : debug_name_(debug_name) {}
  virtual ~Screen() = default;

  // Non-copyable, non-movable (owned by unique_ptr)
  Screen(const Screen&) = delete;
  Screen& operator=(const Screen&) = delete;

  /// Called when screen becomes the active screen.
  /// Create LVGL widgets and input group here.
  virtual pw::Status OnActivate() { return pw::OkStatus(); }

  /// Called when navigating away from this screen.
  virtual void OnDeactivate() {}

  /// Called once per frame while this screen is active.
  /// Update LVGL widgets based on dirty flags here.
  virtual void OnUpdate() {}

  /// Button labels for bottom row (Cancel/OK).
  /// Top row buttons have engraved icons - no on-screen labels needed.
  virtual ButtonConfig GetButtonConfig() const { return {}; }

  /// Handle ESC key press. Override to handle differently (e.g., dismiss popup).
  /// @return true if handled, false to let Navigator pop the screen.
  virtual bool OnEscapePressed() { return false; }

  /// LVGL screen object (created in OnActivate).
  lv_obj_t* lv_screen() const { return lv_screen_; }

  /// LVGL input group for keypad navigation.
  lv_group_t* lv_group() const { return lv_group_; }

  /// Debug name for logging.
  std::string_view debug_name() const { return debug_name_; }

 protected:
  /// Mark screen content as dirty (forces update on next OnUpdate).
  void MarkDirty() { dirty_ = true; }

  /// Check and clear dirty flag. Returns true if was dirty.
  bool CheckAndClearDirty() {
    if (dirty_) {
      dirty_ = false;
      return true;
    }
    return false;
  }

  /// Add widget to this screen's input group (for keypad navigation).
  void AddToGroup(lv_obj_t* widget) {
    if (lv_group_) {
      lv_group_add_obj(lv_group_, widget);
    }
  }

  lv_obj_t* lv_screen_ = nullptr;    // LVGL screen object
  lv_group_t* lv_group_ = nullptr;   // Input group for keypad navigation

 private:
  std::string_view debug_name_;
  bool dirty_ = true;
};

}  // namespace maco::ui
