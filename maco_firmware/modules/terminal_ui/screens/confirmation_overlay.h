// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "lvgl.h"
#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/modules/terminal_ui/ui_action.h"
#include "maco_firmware/modules/ui/button_spec.h"
#include "pw_chrono/system_clock.h"

namespace maco::terminal_ui {

/// Pending confirmation types that the overlay can display.
enum class PendingType : uint8_t {
  kCheckout,
  kTakeover,
  kStop,
};

/// Bottom-sheet overlay for pending confirmation UI.
///
/// Shows a darkened scrim over the active session content with a question
/// card at the bottom. Used for checkout, takeover, and stop confirmations.
/// Created as children of the screen object for proper z-ordering.
class ConfirmationOverlay {
 public:
  explicit ConfirmationOverlay(ActionCallback& action_callback);
  ~ConfirmationOverlay();

  ConfirmationOverlay(const ConfirmationOverlay&) = delete;
  ConfirmationOverlay& operator=(const ConfirmationOverlay&) = delete;

  /// Create LVGL widgets as children of the given parent.
  void Create(lv_obj_t* parent, lv_group_t* group);

  /// Destroy all LVGL widgets.
  void Destroy();

  /// Show the overlay for the given pending type.
  void Show(PendingType type, std::string_view takeover_user_label = {});

  /// Update the takeover user label while already visible.
  void SetTakeoverLabel(std::string_view takeover_user_label);

  /// Hide the overlay.
  void Hide();

  /// Returns true if the overlay is currently visible.
  bool IsVisible() const;

  /// Update cached state for progress computation.
  void UpdateProgress(pw::chrono::SystemClock::time_point pending_since,
                      pw::chrono::SystemClock::time_point pending_deadline,
                      bool tag_present);

  /// Button config for Ja/Nein with progress fill.
  ui::ButtonConfig GetButtonConfig() const;

 private:
  uint8_t ComputeProgress() const;

  ActionCallback& action_callback_;
  PendingType pending_type_ = PendingType::kStop;
  bool visible_ = false;

  // Cached for progress calculation
  pw::chrono::SystemClock::time_point cached_pending_since_;
  pw::chrono::SystemClock::time_point cached_pending_deadline_;
  bool cached_tag_present_ = false;

  // LVGL widgets (on screen layer)
  lv_obj_t* scrim_ = nullptr;
  lv_obj_t* card_ = nullptr;
  lv_obj_t* question_label_ = nullptr;
  lv_obj_t* confirm_btn_ = nullptr;
  lv_group_t* group_ = nullptr;

  // Scrim on lv_layer_top() to dim the status bar
  lv_obj_t* top_scrim_ = nullptr;
};

}  // namespace maco::terminal_ui
