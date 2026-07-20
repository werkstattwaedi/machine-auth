// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/modules/terminal_ui/screens/confirmation_overlay.h"
#include "maco_firmware/modules/terminal_ui/theme.h"
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
///   - Denied: red bg, per-cause heading + short body (QR behind "Info")
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
    kHoldLonger,  // Badge removed mid-auth → "hold the badge longer"
  };

  /// The single source of truth for a state's colours. Every consumer
  /// (GetScreenStyle(), SetVisualState(), the overlay) goes through here, so
  /// the screen and the confirmation sheet cannot drift apart.
  static theme::StateColors ColorsFor(VisualState state);

  void SetVisualState(VisualState state);
  void HideAllWidgets();
  // Populates the denied widgets from the latched rejection fields: a per-cause
  // heading + short body, with the QR (when the server supplied one) moved
  // behind the "Info" button (issue #535/#559).
  void UpdateDenied();

  // --- Persisted notices: denial + "hold longer" (issue #559) ----------------
  // A cloud rejection (kDenied) or a mid-auth removal (kHoldLonger) stays on
  // screen after the badge is gone until the user dismisses it ("OK") or a
  // countdown elapses; a stale-checkout denial's QR moves behind an "Info"
  // button. Latched locally so the verification/session core stays untouched.
  enum class Notice : uint8_t { kNone, kDenied, kHoldLonger };

  // Reconcile the on-screen notice with the verifier state each frame.
  void UpdateNotice(const app_state::TagVerificationSnapshot& verification,
                    bool session_engaged);
  void StartNotice(Notice notice,
                   const app_state::TagVerificationSnapshot& verification);
  void DismissNotice();  // user pressed OK, or the countdown elapsed
  void TickNoticeCountdown();
  void SetNoticeInfoOpen(bool open);

  // Heading/body are keyed on the cause (see CopyForReason); only the
  // stale-checkout message is rendered verbatim, since it carries the date.
  bool IsStaleDenial() const {
    return denial_reason_ == app_state::RejectionReason::kStaleCheckout;
  }

  // The Info/QR view is offered whenever the server gave us a link — today
  // missing-permission and stale-checkout; token unknown/deactivated have a
  // cause but no URL, so they show heading + body only.
  bool HasDenialInfo() const { return !denial_action_url_.empty(); }

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

  // Denied widgets. Every cause renders heading_ + body_ (see CopyForReason);
  // causes that carry an action URL additionally offer a QR + caption behind
  // the "Info" button. denied_qr_url_ caches the last-encoded URL so the QR is
  // only rebuilt when the target changes.
  lv_obj_t* denied_heading_ = nullptr;
  lv_obj_t* denied_body_ = nullptr;
  lv_obj_t* denied_qr_ = nullptr;
  lv_obj_t* denied_qr_caption_ = nullptr;
  // Focusable (size-0) button so the physical OK/ENTER key dismisses the
  // persisted denial; the on-screen pill is drawn by the ButtonBar.
  lv_obj_t* denied_dismiss_btn_ = nullptr;
  // 256 to match the action URL length (snapshot.rejection_action_url); a
  // shorter buffer would trip InlineString::assign's capacity check at runtime.
  pw::InlineString<256> denied_qr_url_;

  // Persisted-notice state (issue #559). notice_ latches a denial/hold-longer so
  // it survives badge removal; the countdown starts once the badge is gone
  // (notice_tag_present_ == false) and pauses while the Info/QR view is open.
  // notice_consumed_ suppresses re-latching the same verifier state after a
  // dismiss/timeout until a new tag engages (kRemovedTooEarly persists on the
  // snapshot, so without this it would immediately reappear).
  Notice notice_ = Notice::kNone;
  bool notice_consumed_ = false;
  bool notice_tag_present_ = false;
  bool notice_info_open_ = false;
  uint32_t notice_countdown_start_ms_ = 0;  // lv_tick baseline for the countdown
  uint8_t notice_progress_ = 0;             // 0-100, cached for GetButtonConfig()
  app_state::RejectionReason denial_reason_ =
      app_state::RejectionReason::kUnspecified;
  pw::InlineString<128> denial_message_;
  pw::InlineString<256> denial_action_url_;

  // Hold-longer widgets (badge removed mid-authorization)
  lv_obj_t* hold_longer_icon_ = nullptr;
  lv_obj_t* hold_longer_label_ = nullptr;

  // Pending confirmation overlay
  ConfirmationOverlay overlay_;

  void ConfigureMachineLabel(bool idle_mode);
};

}  // namespace maco::terminal_ui
