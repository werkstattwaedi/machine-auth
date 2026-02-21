// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <string_view>

namespace maco::ui {

/// Button specification for on-screen pill label, LED color, and pill styling.
struct ButtonSpec {
  std::string_view label;           // On-screen label (empty = hidden)
  uint32_t led_color = 0x000000;    // RGB color for button LED
  uint32_t bg_color = 0x000000;     // Pill background (0 = hidden/transparent)
  uint32_t text_color = 0xFFFFFF;   // Text color on pill
};

/// Configuration for bottom row buttons (OK/Cancel).
/// OK maps to physical bottom-left (LV_KEY_ENTER).
/// Cancel maps to physical bottom-right (LV_KEY_ESC).
struct ButtonConfig {
  ButtonSpec ok;       // Bottom-left button (physical ENTER key)
  ButtonSpec cancel;   // Bottom-right button (physical ESC key)
};

}  // namespace maco::ui
