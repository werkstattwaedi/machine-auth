#include "ui/components/splashscreen.h"

#include "state/system_state.h"
#include "common/time.h"
#include <cmath>

LV_IMG_DECLARE(oww_logo);

namespace oww::ui {

constexpr uint8_t SplashScreen::kRingIndices[];

SplashScreen::SplashScreen(std::shared_ptr<state::IApplicationState> app,
                           hal::IHardware* hardware)
    : Component(app),
      hardware_(hardware),
      current_phase_(std::nullopt),
      next_phase_(std::nullopt),
      animation_start_time_(timeSinceBoot()) {
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
  lv_obj_set_style_bg_color(progress_bar_, lv_color_hex(0xE0E0E0), LV_PART_MAIN);
  lv_obj_set_style_bg_color(progress_bar_, lv_color_hex(0xF9C74F), LV_PART_INDICATOR);

  // Progress label
  progress_label_ = lv_label_create(root_);
  lv_obj_set_style_text_font(progress_label_, &roboto_12, LV_PART_MAIN);
  lv_obj_align(progress_label_, LV_ALIGN_BOTTOM_MID, 0, -10);
}

SplashScreen::~SplashScreen() {
  lv_obj_delete(root_);
}

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

void SplashScreen::GetPhaseColor(state::system::BootPhase phase, uint8_t& r, uint8_t& g, uint8_t& b) {
  switch (phase) {
    case state::system::BootPhase::Bootstrap:
      r = 80; g = 80; b = 200;  // Darker blue for bootstrap
      break;
    case state::system::BootPhase::WaitForDebugger:
      r = 100; g = 100; b = 255;  // Blue
      break;
    case state::system::BootPhase::InitHardware:
      r = 100; g = 150; b = 255;  // Light blue
      break;
    case state::system::BootPhase::ConnectWifi:
      r = 0; g = 255; b = 255;  // Cyan
      break;
    case state::system::BootPhase::ConnectCloud:
      r = 255; g = 200; b = 0;  // Yellow
      break;
    case state::system::BootPhase::WaitForConfig:
      r = 255; g = 0; b = 255;  // Magenta
      break;
    default:
      // Default color (white) for unknown phases
      r = 255; g = 255; b = 255;
      break;
  }
}

float SplashScreen::GetAnimationProgress() {
  auto now = timeSinceBoot();
  auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
      now - animation_start_time_).count();

  // Animation cycle: 1000ms (1 second)
  const float cycle_ms = 1000.0f;
  float t = fmodf(static_cast<float>(elapsed), cycle_ms) / cycle_ms;  // 0..1

  return t;
}

void SplashScreen::UpdateLedAnimation(state::system::BootPhase phase) {
  if (!hardware_) return;

  // Get the color for this phase
  uint8_t r, g, b;
  GetPhaseColor(phase, r, g, b);

  // Get animation progress (0..1 over 1 second)
  float t = GetAnimationProgress();

  // Physics-based easing: accelerate at start, decelerate at end
  // Use a smooth S-curve (smoothstep)
  float eased_t = t * t * (3.0f - 2.0f * t);

  // Extend range to allow fade-in before bottom and fade-out after top
  // Wave width is 0.5, so we need at least 0.25 margin on each side
  // Map 0..1 to -0.3..1.3 for smooth entry and exit
  const float start_offset = -0.3f;
  const float end_offset = 1.3f;
  float wave_position = start_offset + eased_t * (end_offset - start_offset);

  // Ring has 10 LEDs, split into two sides
  // Physical layout:
  // Right side: indices 0, 15, 14, 13, 12 (bottom to top)
  // Left side: indices 9, 8, 7, 6, 5 (top to bottom in array)
  // Array indices: 0-4 = right side, 5-9 = left side

  for (size_t i = 0; i < kRingCount; i++) {
    // Determine position (0 = bottom, 1 = top) for this LED
    float led_position;
    if (i < 5) {
      // Right side (array indices 0-4): bottom to top
      led_position = i / 4.0f;
    } else {
      // Left side (array indices 5-9): physically numbered top to bottom
      // So we need to invert to make upward movement match right side
      led_position = 1.0f - ((i - 5) / 4.0f);
    }

    // Calculate brightness based on position and animation progress
    // Create a smooth wave that moves upward with soft leading and trailing edges
    // Wave center is at position wave_position (starts below 0, ends above 1)
    float distance = led_position - wave_position;

    // Wave profile: smooth bell curve using cosine
    // Wave width: about 0.5 of the ring (covers ~half the height)
    const float wave_width = 0.5f;

    // Calculate normalized distance from wave center (-1 to +1 over wave width)
    float normalized_dist = distance / wave_width;

    // Smooth cosine-based brightness profile
    // Full brightness at center (distance=0), smooth fade on both sides
    float brightness = 0.0f;
    if (fabsf(normalized_dist) < 1.0f) {
      // Use raised cosine for smooth wave profile
      // cos ranges from -1 to 1, we want 0 to 1
      brightness = 0.5f * (1.0f + cosf(normalized_dist * 3.14159265f));

      // Apply power curve for more defined center
      brightness = brightness * brightness;  // Squared for sharper peak
    }

    // Apply brightness to the color
    uint8_t final_r = static_cast<uint8_t>(r * brightness);
    uint8_t final_g = static_cast<uint8_t>(g * brightness);
    uint8_t final_b = static_cast<uint8_t>(b * brightness);

    hardware_->SetLED(kRingIndices[i], final_r, final_g, final_b, 0);
  }

  hardware_->ShowLEDs();
}

void SplashScreen::Render() {
  auto system_state = app_->GetSystemState();

  // Display boot message if in Booting state
  if (std::holds_alternative<state::system::Booting>(*system_state)) {
    auto& booting = std::get<state::system::Booting>(*system_state);

    // Handle phase changes: queue the new phase but let current wave complete
    if (!current_phase_.has_value()) {
      // First phase - start immediately
      current_phase_ = booting.phase;
      animation_start_time_ = timeSinceBoot();
    } else if (current_phase_.value() != booting.phase) {
      // Phase changed - queue the new phase
      if (!next_phase_.has_value()) {
        next_phase_ = booting.phase;
      }

      // Check if current wave has completed (t >= 1.0)
      float t = GetAnimationProgress();
      if (t >= 0.95f) {  // Close to completion
        // Start new wave with queued phase
        current_phase_ = next_phase_.value();
        next_phase_ = std::nullopt;
        animation_start_time_ = timeSinceBoot();
      }
    }

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

    // Update LED animation with current phase (not queued next phase)
    if (current_phase_.has_value()) {
      UpdateLedAnimation(current_phase_.value());
    }
  }
}

}  // namespace oww::ui
