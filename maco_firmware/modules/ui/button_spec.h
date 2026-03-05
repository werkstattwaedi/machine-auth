// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <string_view>

#include "maco_firmware/modules/led_animator/led_animator.h"

namespace maco::ui {

/// Button specification for on-screen pill label, LED effect, and pill styling.
struct ButtonSpec {
  std::string_view label;                      // On-screen label (empty = hidden)
  led_animator::ButtonConfig led_effect;       // LED waveform for this button
  uint32_t bg_color = 0x000000;               // Pill background (0 = hidden/transparent)
  uint32_t text_color = 0xFFFFFF;             // Text color on pill
  uint8_t fill_progress = 0;                  // 0=no fill, 1-100=percentage
};

/// Configuration for bottom row buttons (OK/Cancel).
/// OK maps to physical bottom-left (LV_KEY_ENTER).
/// Cancel maps to physical bottom-right (LV_KEY_ESC).
/// Top-button LEDs are not part of this struct — AppShell drives them
/// automatically based on the active LVGL group's focusable object count.
struct ButtonConfig {
  ButtonSpec ok;       // Bottom-left button (physical ENTER key)
  ButtonSpec cancel;   // Bottom-right button (physical ESC key)
};

}  // namespace maco::ui
