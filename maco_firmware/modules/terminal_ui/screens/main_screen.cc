// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/main_screen.h"

#include <algorithm>

#include "lvgl.h"
#include "maco_firmware/modules/led_animator/button_effects.h"
#include "maco_firmware/modules/terminal_ui/theme.h"
#include "pw_log/log.h"

namespace maco::terminal_ui {

namespace {

// Material Symbols UTF-8 codepoints
constexpr const char kIconSchedule[] = "\xEE\xBF\x96";  // U+EFD6

constexpr int kContentPadding = 16;
constexpr int kUsableWidth = 208;   // 240 - 2*16px padding

// Stale-checkout denied layout (issue #535): the base view is a full-width
// heading + server message; the QR moved behind the "Info" button, where it
// gets shown large and centered so a phone can actually scan it. 150 px leaves
// room below the status bar for the caption to clear the button bar.
constexpr int kInfoQrSize = 150;
constexpr int kInfoQrTop = 36;  // below the status bar

// How long a notice (denial / hold-longer) stays on screen after the badge is
// removed before it auto-dismisses. The "OK" button fills over this window.
constexpr uint32_t kDenialDismissMs = 20000;

constexpr int kSessionColumnTop = 78;  // below the machine name, session modes
constexpr int kSessionRowGap = 8;      // between name, status chip and timer
constexpr int kTimerIconGap = 4;       // between the clock icon and its text

// A name too long to fit gets clamped and ellipsized rather than pushing into
// whatever is below it (issue #532). The user name gets two lines ("Vorname
// Nachname" is the common case); the machine name is a single-line caption.
constexpr int kUserNameMaxLines = 2;
constexpr int kMachineNameMaxLines = 1;

// Per-cause copy for the denied screen.
//
// The headings mirror `rejectionCopy()` in @oww/shared (which drives the
// /denied web page) so the terminal and the page name the same problem. The
// bodies are deliberately shorter than the web copy: this screen only has to
// say *what* is wrong, while the detailed "how do I get access" guidance lives
// on the page behind the QR. Keep the headings in sync if the
// shared copy changes.
struct DenialCopy {
  const char* heading;
  const char* body;
};

DenialCopy CopyForReason(app_state::RejectionReason reason) {
  switch (reason) {
    case app_state::RejectionReason::kStaleCheckout:
      // The body is overridden by the server message, which carries the date.
      return {"Letzter Besuch noch offen",
              "Schliesse deinen letzten Besuch ab."};
    case app_state::RejectionReason::kMissingPermission:
      return {"Berechtigung fehlt",
              "Für diese Maschine brauchst du eine zusätzliche Berechtigung."};
    case app_state::RejectionReason::kTokenUnknown:
      return {"Badge unbekannt", "Dieser Badge ist nicht registriert."};
    case app_state::RejectionReason::kTokenDeactivated:
      return {"Badge deaktiviert", "Dieser Badge wurde deaktiviert."};
    case app_state::RejectionReason::kUnspecified:
      break;
  }
  // Also covers the server's internal errors, whose technical English messages
  // ("Token not registered") must never reach the screen.
  return {"Nicht berechtigt", "Du kannst diese Maschine gerade nicht nutzen."};
}

// Clamp a label to at most `lines` lines, which also re-enables LVGL's native
// ellipsis.
//
// LV_LABEL_LONG_MODE_DOTS only ellipsizes when the text overflows the label's
// height (lv_label.c:1297). At LV_SIZE_CONTENT the label simply grows to fit,
// so that check never trips and long text just wraps. Constraining max_height
// gives the overflow check something to trip on, while leaving a short label at
// its natural height so content below can still reflow upward.
//
// N lines measure N*line_h + (N-1)*line_space (lv_text_get_size_attributes
// accumulates line_h + line_space per line, then drops the trailing
// line_space), so this clamp is exact. It relies on the label's vertical
// padding being 0 — LVGL compares max_height against the content size in
// lv_label's self-size handler but against the box height in lv_obj_pos, and
// those two agree only at zero padding.
void ClampLabelLines(lv_obj_t* label, const lv_font_t* font, int lines) {
  const int32_t line_h = lv_font_get_line_height(font);
  const int32_t line_space =
      lv_obj_get_style_text_line_space(label, LV_PART_MAIN);
  lv_obj_set_style_max_height(
      label, lines * line_h + (lines - 1) * line_space, LV_PART_MAIN);
}

// Format a duration in seconds: "< 1 min", "47 min", "1h05", "2h30".
// Used for the in-use timer (accumulated cutting time), which is what the
// user is billed for.
void FormatDuration(char* buf, size_t buf_size, uint32_t total_seconds) {
  uint32_t total_minutes = total_seconds / 60;
  if (total_minutes < 1) {
    lv_snprintf(buf, buf_size, "< 1 min");
  } else if (total_minutes < 60) {
    lv_snprintf(buf, buf_size, "%d min", static_cast<int>(total_minutes));
  } else {
    int hours = static_cast<int>(total_minutes / 60);
    int mins = static_cast<int>(total_minutes % 60);
    lv_snprintf(buf, buf_size, "%dh%02d", hours, mins);
  }
}

}  // namespace

MainScreen::MainScreen(ActionCallback action_callback)
    : Screen("Main"),
      action_callback_(std::move(action_callback)),
      overlay_(action_callback_) {}

pw::Status MainScreen::OnActivate() {
  lv_screen_ = lv_obj_create(nullptr);
  if (!lv_screen_) {
    return pw::Status::Internal();
  }

  lv_group_ = lv_group_create();

  lv_obj_clear_flag(lv_screen_, LV_OBJ_FLAG_SCROLLABLE);

  // Start with white (idle) background
  lv_obj_set_style_bg_color(
      lv_screen_, lv_color_hex(theme::kColorWhiteBg), LV_PART_MAIN);

  // --- Idle widgets ---
  machine_name_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(machine_name_label_, "");
  lv_obj_set_style_text_font(machine_name_label_, &roboto_36, LV_PART_MAIN);
  lv_obj_set_style_text_color(machine_name_label_,
                              lv_color_hex(theme::kColorDarkText),
                              LV_PART_MAIN);
  lv_obj_set_width(machine_name_label_, kUsableWidth);
  lv_label_set_long_mode(machine_name_label_, LV_LABEL_LONG_MODE_DOTS);
  lv_obj_align(machine_name_label_, LV_ALIGN_TOP_LEFT, kContentPadding, 56);

  instruction_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(instruction_label_, "Mit Badge\nanmelden");
  lv_obj_set_style_text_font(instruction_label_, &roboto_24, LV_PART_MAIN);
  lv_obj_set_style_text_color(instruction_label_,
                              lv_color_hex(theme::kColorDarkText),
                              LV_PART_MAIN);
  lv_obj_align(instruction_label_, LV_ALIGN_TOP_LEFT, kContentPadding, 110);

  // Invisible button to capture OK key press for menu
  menu_btn_ = lv_button_create(lv_screen_);
  lv_obj_set_size(menu_btn_, 0, 0);
  lv_obj_add_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_event_cb(
      menu_btn_,
      [](lv_event_t* e) {
        auto* cb = static_cast<ActionCallback*>(lv_event_get_user_data(e));
        if (*cb) {
          (*cb)(UiAction::kOpenMenu);
        }
      },
      LV_EVENT_PRESSED,
      &action_callback_);
  AddToGroup(menu_btn_);

  // --- Active/Ready widgets (hidden initially) ---
  // A vertical flex column holds the user name, the status chip and the timer
  // row so they reflow to the name's real height: a one-line name keeps the
  // chip snug beneath it, a clamped two-line name pushes it down — no hardcoded
  // y offsets that assume a single line (issue #532).
  session_column_ = lv_obj_create(lv_screen_);
  lv_obj_remove_style_all(session_column_);
  lv_obj_set_size(session_column_, kUsableWidth, LV_SIZE_CONTENT);
  lv_obj_set_pos(session_column_, kContentPadding, kSessionColumnTop);
  lv_obj_set_flex_flow(session_column_, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(session_column_, kSessionRowGap, LV_PART_MAIN);
  lv_obj_clear_flag(session_column_, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(session_column_, LV_OBJ_FLAG_HIDDEN);

  user_name_label_ = lv_label_create(session_column_);
  lv_label_set_text(user_name_label_, "");
  lv_obj_set_style_text_font(user_name_label_, &roboto_36, LV_PART_MAIN);
  lv_obj_set_style_text_color(user_name_label_, lv_color_white(),
                              LV_PART_MAIN);
  lv_obj_set_width(user_name_label_, kUsableWidth);
  lv_label_set_long_mode(user_name_label_, LV_LABEL_LONG_MODE_DOTS);
  ClampLabelLines(user_name_label_, &roboto_36, kUserNameMaxLines);

  // Status chip below the user name, grouped with the timer it describes:
  // reusable state indicator ("Bereit" / "Pausiert" / "In Betrieb").
  // Colours are set per state in SetVisualState(); text per frame in OnUpdate().
  status_chip_ = lv_obj_create(session_column_);
  lv_obj_remove_style_all(status_chip_);
  lv_obj_set_size(status_chip_, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_style_radius(status_chip_, 12, LV_PART_MAIN);
  lv_obj_set_style_pad_hor(status_chip_, 10, LV_PART_MAIN);
  lv_obj_set_style_pad_ver(status_chip_, 4, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(status_chip_, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_clear_flag(status_chip_, LV_OBJ_FLAG_SCROLLABLE);

  status_label_ = lv_label_create(status_chip_);
  lv_label_set_text(status_label_, "");
  lv_obj_set_style_text_font(status_label_, &roboto_16, LV_PART_MAIN);
  lv_obj_center(status_label_);

  // The clock icon and its text share a horizontal row so they toggle as one
  // unit. A hidden flex child collapses (display:none semantics), so hiding the
  // row leaves no gap in the column above.
  timer_row_ = lv_obj_create(session_column_);
  lv_obj_remove_style_all(timer_row_);
  lv_obj_set_size(timer_row_, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(timer_row_, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(timer_row_, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER,
                        LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_column(timer_row_, kTimerIconGap, LV_PART_MAIN);
  lv_obj_clear_flag(timer_row_, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(timer_row_, LV_OBJ_FLAG_HIDDEN);

  timer_icon_ = lv_label_create(timer_row_);
  lv_label_set_text(timer_icon_, kIconSchedule);
  lv_obj_set_style_text_font(timer_icon_, &material_symbols_24, LV_PART_MAIN);
  lv_obj_set_style_text_color(timer_icon_, lv_color_white(), LV_PART_MAIN);

  timer_label_ = lv_label_create(timer_row_);
  lv_label_set_text(timer_label_, "< 1 min");
  lv_obj_set_style_text_font(timer_label_, &roboto_16, LV_PART_MAIN);
  lv_obj_set_style_text_color(timer_label_, lv_color_white(), LV_PART_MAIN);

  // --- Hold-longer widgets (hidden initially) ---
  // Shown on a yellow (warning, not error) background with dark text: the badge
  // was lifted too early, ask the user to hold it on longer.
  hold_longer_icon_ = lv_label_create(lv_screen_);
  lv_label_set_text(hold_longer_icon_, kIconSchedule);
  lv_obj_set_style_text_font(hold_longer_icon_, &material_symbols_64,
                             LV_PART_MAIN);
  lv_obj_set_style_text_color(hold_longer_icon_,
                              lv_color_hex(theme::kColorDarkText), LV_PART_MAIN);
  lv_obj_align(hold_longer_icon_, LV_ALIGN_CENTER, 0, -20);
  lv_obj_add_flag(hold_longer_icon_, LV_OBJ_FLAG_HIDDEN);

  hold_longer_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(hold_longer_label_, "Badge länger\nauflegen");
  lv_obj_set_style_text_font(hold_longer_label_, &roboto_24, LV_PART_MAIN);
  lv_obj_set_style_text_align(hold_longer_label_, LV_TEXT_ALIGN_CENTER,
                              LV_PART_MAIN);
  lv_obj_set_style_text_color(hold_longer_label_,
                              lv_color_hex(theme::kColorDarkText), LV_PART_MAIN);
  lv_obj_align(hold_longer_label_, LV_ALIGN_CENTER, 0, 40);
  lv_obj_add_flag(hold_longer_label_, LV_OBJ_FLAG_HIDDEN);

  // --- Stale-checkout denied widgets (issue #535, hidden initially) ---
  // Base view: a full-width heading + server message (the message no longer
  // shares the row with the QR, so it can use the whole width and stay
  // readable). The QR lives behind the "Info" button (SetDenialInfoOpen), where
  // it is shown large and centered — an 88 px QR of the long /denied URL was
  // unscannable.
  denied_heading_ = lv_label_create(lv_screen_);
  lv_label_set_text(denied_heading_, "Letzter Besuch noch offen");
  lv_obj_set_style_text_font(denied_heading_, &roboto_24, LV_PART_MAIN);
  lv_obj_set_style_text_color(denied_heading_, lv_color_white(), LV_PART_MAIN);
  lv_obj_set_width(denied_heading_, kUsableWidth);
  lv_label_set_long_mode(denied_heading_, LV_LABEL_LONG_MODE_WRAP);
  lv_obj_align(denied_heading_, LV_ALIGN_TOP_LEFT, kContentPadding, 46);
  lv_obj_add_flag(denied_heading_, LV_OBJ_FLAG_HIDDEN);

  denied_body_ = lv_label_create(lv_screen_);
  lv_label_set_text(denied_body_, "");
  lv_obj_set_style_text_font(denied_body_, &roboto_16, LV_PART_MAIN);
  lv_obj_set_style_text_color(denied_body_, lv_color_white(), LV_PART_MAIN);
  lv_obj_set_width(denied_body_, kUsableWidth);
  lv_label_set_long_mode(denied_body_, LV_LABEL_LONG_MODE_WRAP);
  lv_obj_align(denied_body_, LV_ALIGN_TOP_LEFT, kContentPadding, 104);
  lv_obj_add_flag(denied_body_, LV_OBJ_FLAG_HIDDEN);

  // QR code (Info view): black modules on a white quiet zone so it scans
  // against the red background, shown large and centered. Data is filled from
  // the latched server action URL when the Info view opens.
  denied_qr_ = lv_qrcode_create(lv_screen_);
  lv_qrcode_set_size(denied_qr_, kInfoQrSize);
  lv_qrcode_set_dark_color(denied_qr_, lv_color_black());
  lv_qrcode_set_light_color(denied_qr_, lv_color_white());
  lv_obj_set_style_border_color(denied_qr_, lv_color_white(), LV_PART_MAIN);
  lv_obj_set_style_border_width(denied_qr_, 8, LV_PART_MAIN);
  lv_obj_align(denied_qr_, LV_ALIGN_TOP_MID, 0, kInfoQrTop);
  lv_obj_add_flag(denied_qr_, LV_OBJ_FLAG_HIDDEN);

  denied_qr_caption_ = lv_label_create(lv_screen_);
  // Cause-neutral: the page behind the QR carries the per-cause detail, so this
  // caption must not promise a specific action.
  lv_label_set_text(denied_qr_caption_, "Scanne den Code für mehr Infos");
  lv_obj_set_style_text_font(denied_qr_caption_, &roboto_16, LV_PART_MAIN);
  lv_obj_set_style_text_color(denied_qr_caption_, lv_color_white(),
                              LV_PART_MAIN);
  lv_obj_set_width(denied_qr_caption_, kUsableWidth);
  lv_label_set_long_mode(denied_qr_caption_, LV_LABEL_LONG_MODE_WRAP);
  lv_obj_set_style_text_align(denied_qr_caption_, LV_TEXT_ALIGN_CENTER,
                              LV_PART_MAIN);
  // QR widget height = size + 2*8 px border; the caption sits 10 px below it.
  lv_obj_align(denied_qr_caption_, LV_ALIGN_TOP_MID, 0,
               kInfoQrTop + kInfoQrSize + 16 + 10);
  lv_obj_add_flag(denied_qr_caption_, LV_OBJ_FLAG_HIDDEN);

  // Invisible focusable button so the physical OK/ENTER key dismisses a
  // persisted denial (mirrors menu_btn_). The visible pill is the ButtonBar.
  denied_dismiss_btn_ = lv_button_create(lv_screen_);
  lv_obj_set_size(denied_dismiss_btn_, 0, 0);
  lv_obj_add_flag(denied_dismiss_btn_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_event_cb(
      denied_dismiss_btn_,
      [](lv_event_t* e) {
        auto* self = static_cast<MainScreen*>(lv_event_get_user_data(e));
        // On the Info/QR view the physical OK returns to the message (matching
        // the on-screen "Zurück"); otherwise it dismisses the notice.
        if (self->notice_info_open_) {
          self->SetNoticeInfoOpen(false);
        } else {
          self->DismissNotice();
        }
      },
      LV_EVENT_PRESSED,
      this);
  AddToGroup(denied_dismiss_btn_);

  // --- Confirmation overlay (created last for z-order) ---
  overlay_.Create(lv_screen_, lv_group_);

  // Initialize widget visibility for the starting state
  SetVisualState(visual_state_);

  // Widgets were recreated — force Watched values to re-push on next OnUpdate()
  machine_label_.MarkDirty();

  PW_LOG_INFO("MainScreen activated");
  return pw::OkStatus();
}

void MainScreen::OnDeactivate() {
  overlay_.Destroy();
  if (lv_group_) {
    lv_group_delete(lv_group_);
    lv_group_ = nullptr;
  }
  lv_screen_ = nullptr;
  machine_name_label_ = nullptr;
  instruction_label_ = nullptr;
  menu_btn_ = nullptr;
  session_column_ = nullptr;
  status_chip_ = nullptr;
  status_label_ = nullptr;
  user_name_label_ = nullptr;
  timer_row_ = nullptr;
  timer_icon_ = nullptr;
  timer_label_ = nullptr;
  hold_longer_icon_ = nullptr;
  hold_longer_label_ = nullptr;
  denied_heading_ = nullptr;
  denied_body_ = nullptr;
  denied_qr_ = nullptr;
  denied_qr_caption_ = nullptr;
  denied_dismiss_btn_ = nullptr;
  denied_qr_url_.clear();
  // Reset the notice latch so a later reactivation can't replay a stale
  // lv_tick baseline (which would flash-dismiss on the first frame) or a stale
  // denial cause. Not reachable today — the menu (the only push/pop path) is
  // only reachable from kIdle/kReady/kActive where notice_ is kNone — but this
  // keeps that from silently becoming a bug.
  notice_ = Notice::kNone;
  notice_consumed_ = false;
  notice_tag_present_ = false;
  notice_info_open_ = false;
  notice_progress_ = 0;
  PW_LOG_INFO("MainScreen deactivated");
}

void MainScreen::OnUpdate(const app_state::AppStateSnapshot& snapshot) {
  // Determine if a pending confirmation is active
  bool is_pending =
      snapshot.session.state == app_state::SessionStateUi::kCheckoutPending ||
      snapshot.session.state == app_state::SessionStateUi::kTakeoverPending ||
      snapshot.session.state == app_state::SessionStateUi::kStopPending;
  bool is_ending_soon =
      snapshot.session.state == app_state::SessionStateUi::kEndingSoon;

  // --- Persisted notices ------------------------------------------------
  // Keep a denial / "hold longer" on screen after the badge is gone so a
  // walk-up user can read and dismiss it (see UpdateNotice()).
  const bool session_engaged =
      snapshot.session.state != app_state::SessionStateUi::kNoSession;
  UpdateNotice(snapshot.verification, session_engaged);
  // Advance the auto-dismiss countdown; may DismissNotice() when it elapses.
  TickNoticeCountdown();

  // Derive visual state. A session is green while the machine is actually in
  // use and yellow while it's ready-but-idle (e.g. laser powered but not
  // cutting). A pending confirmation or the idle-warning only adds the overlay
  // on top — it must not change the state colour, otherwise the sheet claims
  // the machine is running when it isn't.
  VisualState new_state;
  if (is_ending_soon) {
    // The warning only fires while the machine is idle.
    new_state = VisualState::kReady;
  } else if (is_pending ||
             snapshot.session.state == app_state::SessionStateUi::kRunning) {
    new_state = snapshot.machine.machine_running ? VisualState::kActive
                                                 : VisualState::kReady;
  } else if (notice_ == Notice::kDenied) {
    new_state = VisualState::kDenied;
  } else if (notice_ == Notice::kHoldLonger) {
    new_state = VisualState::kHoldLonger;
  } else {
    new_state = VisualState::kIdle;
  }

  if (new_state != visual_state_) {
    SetVisualState(new_state);
  }

  // The denied layout depends on the latched rejection cause + message/URL and
  // whether the Info/QR view is open — refresh it every frame while denied.
  if (visual_state_ == VisualState::kDenied) {
    UpdateDenied();
  }

  // Update machine name from snapshot (may change if config reloads)
  machine_label_.Set(snapshot.system.machine_label);
  if (machine_label_.CheckAndClearDirty()) {
    lv_label_set_text(machine_name_label_, machine_label_.Get().c_str());
  }

  // Update active/ready dynamic content (including when overlay is visible).
  if (visual_state_ == VisualState::kActive ||
      visual_state_ == VisualState::kReady) {
    lv_label_set_text(user_name_label_,
                      snapshot.session.session_user_label.c_str());

    const bool cutting = visual_state_ == VisualState::kActive;
    const uint32_t in_use = snapshot.machine.in_use_seconds;

    // Status chip: in use → "In Betrieb"; idle with no accrued time yet →
    // "Bereit"; idle after some cutting → "Pausiert" (the timer is frozen).
    const char* status =
        cutting ? "In Betrieb" : (in_use > 0 ? "Pausiert" : "Bereit");
    lv_label_set_text(status_label_, status);

    // The timer shows accumulated in-use (billed) time. Hide it until there
    // is something to show, so a fresh "Bereit" screen stays clean.
    const bool show_timer = cutting || in_use > 0;
    if (show_timer) {
      char time_buf[16];
      FormatDuration(time_buf, sizeof(time_buf), in_use);
      lv_label_set_text(timer_label_, time_buf);
      lv_obj_remove_flag(timer_row_, LV_OBJ_FLAG_HIDDEN);
    } else {
      lv_obj_add_flag(timer_row_, LV_OBJ_FLAG_HIDDEN);
    }
  }

  // Manage overlay visibility (pending confirmations + idle-end warning)
  if (is_pending || is_ending_soon) {
    PendingType type;
    std::string_view takeover_label;
    if (snapshot.session.state == app_state::SessionStateUi::kCheckoutPending) {
      type = PendingType::kCheckout;
    } else if (snapshot.session.state ==
               app_state::SessionStateUi::kTakeoverPending) {
      type = PendingType::kTakeover;
      takeover_label = std::string_view(
          snapshot.session.pending_user_label.data(),
          snapshot.session.pending_user_label.size());
    } else if (is_ending_soon) {
      type = PendingType::kIdleWarning;
    } else {
      type = PendingType::kStop;
    }

    // The card wears the screen's own state colours, so it always agrees with
    // the background behind it.
    const theme::StateColors colors = ColorsFor(visual_state_);

    if (!overlay_.IsVisible()) {
      // Hide menu button so only confirm_btn_ is focusable — prevents
      // AppShell from lighting up the navigation LEDs.
      lv_obj_add_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
      overlay_.Show(type, colors, takeover_label);
    } else if (type == PendingType::kTakeover) {
      overlay_.SetTakeoverLabel(takeover_label);
    }

    // Re-applied every frame: the machine can start or stop while the sheet
    // is up, and the card must follow the state across that transition.
    overlay_.SetColors(colors);
    overlay_.UpdateProgress(snapshot.session.pending_since,
                            snapshot.session.pending_deadline,
                            snapshot.session.tag_present);
    MarkDirty();
  } else if (overlay_.IsVisible()) {
    overlay_.Hide();
    // Restore menu button and focus when overlay dismissed
    lv_obj_remove_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
    if (lv_group_) {
      lv_group_focus_obj(menu_btn_);
    }
    MarkDirty();
  }
}

bool MainScreen::OnEscapePressed() {
  if (overlay_.IsVisible()) {
    if (action_callback_) {
      action_callback_(UiAction::kCancel);
    }
    return true;
  }
  if (visual_state_ == VisualState::kActive ||
      visual_state_ == VisualState::kReady) {
    if (action_callback_) {
      action_callback_(UiAction::kStopSession);
    }
    return true;
  }
  if (visual_state_ == VisualState::kDenied) {
    // ESC is the "Info" button: reveal the QR, or return from it. Only the
    // stale-checkout denial has a QR/Info view; generic denials swallow ESC.
    if (notice_info_open_) {
      SetNoticeInfoOpen(false);
    } else if (HasDenialInfo()) {
      SetNoticeInfoOpen(true);
    }
    return true;
  }
  if (visual_state_ == VisualState::kHoldLonger) {
    return true;
  }
  return false;
}

ui::ButtonConfig MainScreen::GetButtonConfig() const {
  if (overlay_.IsVisible()) {
    return overlay_.GetButtonConfig();
  }

  switch (visual_state_) {
    case VisualState::kIdle:
      return {
          .ok = {.label = "Menü",
                 .led_effect = led_animator::SolidButton(
                     led::RgbwColor::FromRgb(theme::kColorYellow)),
                 .bg_color = theme::kColorYellow,
                 .text_color = theme::kColorDarkText},
          .cancel = {},
      };
    case VisualState::kReady:
    case VisualState::kActive:
      return {
          .ok = {.label = "Menü",
                 .led_effect = led_animator::SolidButton(
                     led::RgbwColor::FromRgb(theme::kColorYellow)),
                 .bg_color = theme::kColorYellow,
                 .text_color = theme::kColorDarkText},
          .cancel = {.label = "Stopp",
                     .led_effect = led_animator::SolidButton(
                         led::RgbwColor::FromRgb(theme::kColorBtnRed)),
                     .bg_color = theme::kColorBtnRed,
                     .text_color = 0xFFFFFF},
      };
    case VisualState::kDenied: {
      const led_animator::ButtonConfig yellow = led_animator::SolidButton(
          led::RgbwColor::FromRgb(theme::kColorYellow));
      ui::ButtonConfig cfg;
      if (notice_info_open_) {
        // Info/QR view: a single "Zurück" (Cancel) returns to the message. OK
        // is hidden here so it does not duplicate "Zurück".
        cfg.cancel = {.label = "Zurück",
                      .led_effect = yellow,
                      .bg_color = theme::kColorYellow,
                      .text_color = theme::kColorDarkText};
        return cfg;
      }
      // Base view: OK dismisses and fills over the auto-dismiss countdown. Only
      // the stale-checkout denial has a QR to reveal, so only it shows "Info".
      // "OK" (not "Verstanden") so the label fits when the ButtonBar splits the
      // width between two pills.
      cfg.ok = {.label = "OK",
                .led_effect = yellow,
                .bg_color = theme::kColorYellow,
                .text_color = theme::kColorDarkText,
                .fill_progress = notice_progress_};
      if (HasDenialInfo()) {
        cfg.cancel = {.label = "Info",
                      .led_effect = yellow,
                      .bg_color = theme::kColorYellow,
                      .text_color = theme::kColorDarkText};
      }
      return cfg;
    }
    case VisualState::kHoldLonger:
      // OK dismisses the "hold the badge longer" prompt and fills over the same
      // auto-dismiss countdown.
      return {
          .ok = {.label = "OK",
                 .led_effect = led_animator::SolidButton(
                     led::RgbwColor::FromRgb(theme::kColorYellow)),
                 .bg_color = theme::kColorYellow,
                 .text_color = theme::kColorDarkText,
                 .fill_progress = notice_progress_},
          .cancel = {},
      };
  }
  return {};
}

theme::StateColors MainScreen::ColorsFor(VisualState state) {
  switch (state) {
    case VisualState::kIdle:
      return {.bg = theme::kColorWhiteBg, .text = theme::kColorDarkText};
    case VisualState::kReady:
      // Yellow needs dark text for contrast; the darker states take white.
      return {.bg = theme::kColorYellow, .text = theme::kColorDarkText};
    case VisualState::kActive:
      return {.bg = theme::kColorGreen, .text = theme::kColorText};
    case VisualState::kDenied:
      return {.bg = theme::kColorRed, .text = theme::kColorText};
    case VisualState::kHoldLonger:
      // Yellow needs dark text for contrast, same rule as kReady.
      return {.bg = theme::kColorYellow, .text = theme::kColorDarkText};
  }
  return {.bg = theme::kColorWhiteBg, .text = theme::kColorDarkText};
}

ui::ScreenStyle MainScreen::GetScreenStyle() const {
  return {.bg_color = ColorsFor(visual_state_).bg};
}

void MainScreen::ConfigureMachineLabel(bool idle_mode) {
  // The clamp height is font-relative, so it must be recomputed whenever the
  // font changes between modes.
  if (idle_mode) {
    lv_obj_set_style_text_font(machine_name_label_, &roboto_36, LV_PART_MAIN);
    lv_obj_set_style_text_color(machine_name_label_,
                                lv_color_hex(theme::kColorDarkText),
                                LV_PART_MAIN);
    lv_obj_align(machine_name_label_, LV_ALIGN_TOP_LEFT, kContentPadding, 56);
    ClampLabelLines(machine_name_label_, &roboto_36, kMachineNameMaxLines);
  } else {
    lv_obj_set_style_text_font(machine_name_label_, &roboto_24, LV_PART_MAIN);
    lv_obj_align(machine_name_label_, LV_ALIGN_TOP_LEFT, kContentPadding, 44);
    ClampLabelLines(machine_name_label_, &roboto_24, kMachineNameMaxLines);
  }
}

void MainScreen::SetVisualState(VisualState state) {
  visual_state_ = state;
  HideAllWidgets();

  const theme::StateColors colors = ColorsFor(state);
  switch (state) {
    case VisualState::kIdle:
      ConfigureMachineLabel(true);
      lv_obj_remove_flag(machine_name_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(instruction_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
      if (lv_group_) {
        lv_group_focus_obj(menu_btn_);
      }
      break;
    case VisualState::kReady:
    case VisualState::kActive: {
      lv_color_t text_color = lv_color_hex(colors.text);
      ConfigureMachineLabel(false);
      lv_obj_set_style_text_color(machine_name_label_, text_color, LV_PART_MAIN);
      lv_obj_set_style_text_color(user_name_label_, text_color, LV_PART_MAIN);
      lv_obj_set_style_text_color(timer_icon_, text_color, LV_PART_MAIN);
      lv_obj_set_style_text_color(timer_label_, text_color, LV_PART_MAIN);

      // Status chip: a darker shade of the state colour, so it reads as a
      // distinct pill on any background, with a contrasting label.
      uint32_t chip_bg = theme::DarkenColor(colors.bg, 64);
      lv_color_t chip_text = theme::IsLightColor(chip_bg)
                                 ? lv_color_hex(theme::kColorDarkText)
                                 : lv_color_white();
      lv_obj_set_style_bg_color(status_chip_, lv_color_hex(chip_bg),
                                LV_PART_MAIN);
      lv_obj_set_style_text_color(status_label_, chip_text, LV_PART_MAIN);

      lv_obj_remove_flag(machine_name_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(session_column_, LV_OBJ_FLAG_HIDDEN);
      // The timer row's visibility depends on accrued time — OnUpdate() manages
      // it; the name and status chip come up with the column.
      lv_obj_remove_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
      if (lv_group_) {
        lv_group_focus_obj(menu_btn_);
      }
      break;
    }
    case VisualState::kDenied:
      // Content widgets (generic icon/label vs. stale heading/message, or the
      // Info/QR view) are managed per-frame by UpdateDenied(). Here we only arm
      // the invisible dismiss button so the physical OK/ENTER key clears the
      // persisted denial.
      lv_obj_remove_flag(denied_dismiss_btn_, LV_OBJ_FLAG_HIDDEN);
      if (lv_group_) {
        lv_group_focus_obj(denied_dismiss_btn_);
      }
      break;
    case VisualState::kHoldLonger:
      // Background comes from ColorsFor(kHoldLonger); reveal the widgets and arm
      // the dismiss button so OK clears the prompt instead of the menu button
      // stealing focus and opening the menu.
      lv_obj_remove_flag(hold_longer_icon_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(hold_longer_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(denied_dismiss_btn_, LV_OBJ_FLAG_HIDDEN);
      if (lv_group_) {
        lv_group_focus_obj(denied_dismiss_btn_);
      }
      break;
  }

  lv_obj_set_style_bg_color(lv_screen_, lv_color_hex(colors.bg), LV_PART_MAIN);
  MarkDirty();
}

void MainScreen::HideAllWidgets() {
  lv_obj_add_flag(machine_name_label_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(instruction_label_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
  // Hiding the column hides the name, chip and timer row it contains.
  lv_obj_add_flag(session_column_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(hold_longer_icon_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(hold_longer_label_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(denied_heading_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(denied_body_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(denied_qr_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(denied_qr_caption_, LV_OBJ_FLAG_HIDDEN);
  // Also drop the dismiss button from the focus group when not denied.
  lv_obj_add_flag(denied_dismiss_btn_, LV_OBJ_FLAG_HIDDEN);
}

// Populate the denied screen from the latched rejection fields. Heading + body
// come from the per-cause table (keyed on the *cause*, never on URL presence —
// missing-permission also carries a /denied URL, and keying on that wrongly
// gave it the stale-checkout copy). The Info/QR view is offered whenever the
// server supplied an action URL (issue #535).
void MainScreen::UpdateDenied() {
  const DenialCopy copy = CopyForReason(denial_reason_);
  lv_label_set_text(denied_heading_, copy.heading);
  // Only the stale-checkout message is worth rendering verbatim — it carries
  // the visit's date. Every other cause uses local copy, which also keeps the
  // server's technical strings off the screen.
  lv_label_set_text(denied_body_, (IsStaleDenial() && !denial_message_.empty())
                                      ? denial_message_.c_str()
                                      : copy.body);

  if (notice_info_open_) {
    // Info view: the QR takes the screen. Rebuild it only when the target URL
    // changes — lv_qrcode_update re-encodes, wasted work every frame otherwise.
    const std::string_view url(denial_action_url_);
    if (std::string_view(denied_qr_url_) != url) {
      denied_qr_url_.assign(url.data(), url.size());
      if (lv_qrcode_update(denied_qr_, url.data(), url.size()) !=
          LV_RESULT_OK) {
        PW_LOG_WARN("Failed to encode denied-screen QR (url len %zu)",
                    url.size());
      }
    }
    lv_obj_add_flag(denied_heading_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(denied_body_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(denied_qr_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(denied_qr_caption_, LV_OBJ_FLAG_HIDDEN);
  } else {
    // Base view: full-width heading + message; QR hidden behind "Info".
    lv_obj_remove_flag(denied_heading_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(denied_body_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(denied_qr_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(denied_qr_caption_, LV_OBJ_FLAG_HIDDEN);
  }
}

// Reconcile the persisted notice with the verifier state each frame (issue
// A denial (kUnauthorized) flips to kIdle when the badge leaves, so we
// keep it latched across that. A mid-auth removal (kRemovedTooEarly) instead
// persists on the snapshot until the next tag, so after it is dismissed
// notice_consumed_ suppresses it until a new tag engages — otherwise it would
// immediately reappear.
void MainScreen::UpdateNotice(
    const app_state::TagVerificationSnapshot& verification,
    bool session_engaged) {
  using app_state::TagVerificationState;
  const auto v = verification.state;

  // A live tag interaction (or an active session) supersedes any notice and
  // re-arms it for the next rejection.
  const bool engaged = session_engaged ||
                       v == TagVerificationState::kTagDetected ||
                       v == TagVerificationState::kVerifying ||
                       v == TagVerificationState::kGenuine ||
                       v == TagVerificationState::kUnknownTag ||
                       v == TagVerificationState::kAuthorizing ||
                       v == TagVerificationState::kAuthorized;
  if (engaged) {
    notice_consumed_ = false;
    if (notice_ != Notice::kNone) {
      notice_ = Notice::kNone;
      notice_info_open_ = false;
      MarkDirty();
    }
    return;
  }

  // Only kIdle / kUnauthorized / kRemovedTooEarly remain here.
  Notice raw = Notice::kNone;
  if (v == TagVerificationState::kUnauthorized) {
    raw = Notice::kDenied;
  } else if (v == TagVerificationState::kRemovedTooEarly) {
    raw = Notice::kHoldLonger;
  }

  if (notice_consumed_) {
    // Already dismissed this interaction; stay quiet until a new tag engages.
    if (notice_ != Notice::kNone) {
      notice_ = Notice::kNone;
      notice_info_open_ = false;
      MarkDirty();
    }
    return;
  }

  if (raw != Notice::kNone) {
    if (notice_ != raw) {
      StartNotice(raw, verification);
    }
    // A denial's badge is still on the reader; a hold-longer's badge is already
    // gone. The countdown only runs once the badge is gone.
    notice_tag_present_ = (raw == Notice::kDenied);
  } else if (notice_ == Notice::kDenied) {
    // Denial persists after the badge is removed (kUnauthorized → kIdle).
    notice_tag_present_ = false;
  }
}

// Latch a fresh notice. For a denial, copy the cause/message/URL locally so the
// UI stays correct across reactivation/animation frames without depending on
// TagVerifier's snapshot retention; a hold-longer carries none.
void MainScreen::StartNotice(
    Notice notice, const app_state::TagVerificationSnapshot& verification) {
  notice_ = notice;
  notice_info_open_ = false;
  notice_countdown_start_ms_ = lv_tick_get();
  notice_progress_ = 0;
  if (notice == Notice::kDenied) {
    denial_reason_ = verification.rejection_reason;
    denial_message_.assign(verification.rejection_message.data(),
                           verification.rejection_message.size());
    denial_action_url_.assign(verification.rejection_action_url.data(),
                              verification.rejection_action_url.size());
  } else {
    denial_reason_ = app_state::RejectionReason::kUnspecified;
    denial_message_.clear();
    denial_action_url_.clear();
  }
  MarkDirty();
}

// User pressed OK, or the countdown elapsed. notice_consumed_ keeps a still-
// latched kRemovedTooEarly from immediately reappearing.
void MainScreen::DismissNotice() {
  notice_ = Notice::kNone;
  notice_consumed_ = true;
  notice_info_open_ = false;
  notice_progress_ = 0;
  MarkDirty();
}

// Advance the auto-dismiss countdown. It only runs once the badge is gone and
// the Info/QR view is closed; while paused the baseline is held at "now" so the
// user always gets a full window when it resumes. Dismisses at 100%.
void MainScreen::TickNoticeCountdown() {
  if (notice_ == Notice::kNone) {
    notice_progress_ = 0;
    return;
  }
  if (notice_tag_present_ || notice_info_open_) {
    notice_countdown_start_ms_ = lv_tick_get();
    notice_progress_ = 0;
    return;
  }
  const uint32_t elapsed = lv_tick_get() - notice_countdown_start_ms_;
  if (elapsed >= kDenialDismissMs) {
    DismissNotice();
    return;
  }
  notice_progress_ = static_cast<uint8_t>(elapsed * 100 / kDenialDismissMs);
}

void MainScreen::SetNoticeInfoOpen(bool open) {
  if (notice_info_open_ == open) {
    return;
  }
  notice_info_open_ = open;
  MarkDirty();
}

}  // namespace maco::terminal_ui
