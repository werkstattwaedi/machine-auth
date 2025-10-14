#include "ui/components/splashscreen.h"

#include <memory>

#include "state/system_state.h"
#include "ui/leds/boot_wave_effect.h"

LV_IMG_DECLARE(oww_logo);

namespace oww::ui {

SplashScreen::SplashScreen(std::shared_ptr<state::IApplicationState> app,
                           hal::IHardware* hardware)
    : Component(app), hardware_(hardware), last_phase_(std::nullopt) {
  lv_obj_set_style_bg_color(lv_screen_active(), lv_color_white(), LV_PART_MAIN);

  root_ = lv_obj_create(lv_screen_active());
  lv_obj_set_size(root_, 240, 320);
  lv_obj_align(root_, LV_ALIGN_TOP_LEFT, 0, 0);

  static lv_style_t style;
  lv_style_init(&style);
  lv_style_set_radius(&style, 5);

  auto logo = lv_image_create(root_);
  lv_image_set_src(logo, &oww_logo);
  lv_obj_align(logo, LV_ALIGN_CENTER, 0, -20);

  // Progress bar (positioned above the label)
  progress_bar_ = lv_bar_create(root_);
  lv_obj_set_size(progress_bar_, 180, 8);
  lv_obj_align(progress_bar_, LV_ALIGN_BOTTOM_MID, 0, -30);
  lv_bar_set_value(progress_bar_, 0, LV_ANIM_OFF);
  lv_obj_set_style_bg_color(progress_bar_, lv_color_hex(0xE0E0E0),
                            LV_PART_MAIN);
  lv_obj_set_style_bg_color(progress_bar_, lv_color_hex(0xF9C74F),
                            LV_PART_INDICATOR);

  // Progress label
  progress_label_ = lv_label_create(root_);
  lv_obj_set_style_text_font(progress_label_, &roboto_12, LV_PART_MAIN);
  lv_obj_align(progress_label_, LV_ALIGN_BOTTOM_MID, 0, -10);
}

SplashScreen::~SplashScreen() { lv_obj_delete(root_); }

const char* SplashScreen::GetPhaseMessage(state::system::BootPhase phase) {
  switch (phase) {
    case state::system::BootPhase::Bootstrap:
      return "Starte...";
    case state::system::BootPhase::WaitForDebugger:
      return "Warte auf Debugger...";
    case state::system::BootPhase::InitHardware:
      return "Hardware wird initialisiert...";
    case state::system::BootPhase::ConnectWifi:
      return "Verbinde mit WiFi...";
    case state::system::BootPhase::ConnectCloud:
      return "Verbinde mit Cloud...";
    case state::system::BootPhase::WaitForConfig:
      return "Lade Konfiguration...";
    default:
      return "Starte...";
  }
}

hal::LedColor SplashScreen::GetPhaseColor(state::system::BootPhase phase) {
  switch (phase) {
    case state::system::BootPhase::Bootstrap:
      return hal::LedColor{80, 80, 200, 0};  // Darker blue for bootstrap
    case state::system::BootPhase::WaitForDebugger:
      return hal::LedColor{100, 100, 255, 0};  // Blue
    case state::system::BootPhase::InitHardware:
      return hal::LedColor{100, 150, 255, 0};  // Light blue
    case state::system::BootPhase::ConnectWifi:
      return hal::LedColor{0, 255, 255, 0};  // Cyan
    case state::system::BootPhase::ConnectCloud:
      return hal::LedColor{255, 200, 0, 0};  // Yellow
    case state::system::BootPhase::WaitForConfig:
      return hal::LedColor{255, 0, 255, 0};  // Magenta
    default:
      return hal::LedColor{255, 255, 255, 0};  // White for unknown phases
  }
}

leds::LedEffect SplashScreen::GetLedEffect() {
  auto system_state = app_->GetSystemState();

  // Only provide effect when in Booting state
  if (!std::holds_alternative<state::system::Booting>(*system_state)) {
    return nullptr;
  }

  auto& booting = std::get<state::system::Booting>(*system_state);

  // Create new effect when phase changes
  if (!last_phase_.has_value() || last_phase_.value() != booting.phase) {
    hal::LedColor color = GetPhaseColor(booting.phase);
    current_effect_ = leds::CreateBootWaveEffect(color, 1000);
    last_phase_ = booting.phase;
  }

  return current_effect_;
}

void SplashScreen::Render() {
  auto system_state = app_->GetSystemState();

  // Display boot message if in Booting state
  if (std::holds_alternative<state::system::Booting>(*system_state)) {
    auto& booting = std::get<state::system::Booting>(*system_state);

    // Update progress label
    const char* message = GetPhaseMessage(booting.phase);
    if (strcmp(message, lv_label_get_text(progress_label_)) != 0) {
      lv_label_set_text(progress_label_, message);
    }

    // Update progress bar based on phase
    int32_t progress = 0;
    switch (booting.phase) {
      case state::system::BootPhase::Bootstrap:
        progress = 0;
        break;
      case state::system::BootPhase::WaitForDebugger:
        progress = 0;
        break;
      case state::system::BootPhase::InitHardware:
        progress = 20;
        break;
      case state::system::BootPhase::ConnectWifi:
        progress = 40;
        break;
      case state::system::BootPhase::ConnectCloud:
        progress = 60;
        break;
      case state::system::BootPhase::WaitForConfig:
        progress = 80;
        break;
    }
    lv_bar_set_value(progress_bar_, progress, LV_ANIM_ON);
  }
}

}  // namespace oww::ui
