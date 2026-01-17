// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <string_view>

namespace maco::ui {

/// Button specification for on-screen label and LED color.
struct ButtonSpec {
  std::string_view label;           // On-screen label (empty = hidden)
  uint32_t led_color = 0x000000;    // RGB color for button LED
};

/// Configuration for bottom row buttons (Cancel/OK).
/// Top row buttons (Up/Down) have engraved icons - no on-screen labels needed.
struct ButtonConfig {
  ButtonSpec cancel;   // Bottom-left button
  ButtonSpec ok;       // Bottom-right button
};

}  // namespace maco::ui
