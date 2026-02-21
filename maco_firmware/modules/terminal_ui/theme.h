// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

namespace maco::terminal_ui::theme {

// Dark theme colors (splash screen)
constexpr uint32_t kColorBg = 0x1a1a2e;        // Dark navy background
constexpr uint32_t kColorCard = 0x252540;       // Panel/card background
constexpr uint32_t kColorBorder = 0x3a3a5c;     // Subtle borders
constexpr uint32_t kColorText = 0xffffff;       // Primary text (white)
constexpr uint32_t kColorMuted = 0x888888;      // Secondary text
constexpr uint32_t kColorTeal = 0x4dbdc6;       // Primary accent
constexpr uint32_t kColorTealDark = 0x3aa8b1;   // Pressed accent
constexpr uint32_t kColorGold = 0xffde80;       // Warm accent (logo underline)
constexpr uint32_t kColorGoldDark = 0xe6b800;   // Emphasis accent
constexpr uint32_t kColorError = 0xe57373;      // Error/warning
constexpr uint32_t kColorSuccess = 0x81c784;    // Success/confirmed

// State-based background colors
constexpr uint32_t kColorWhiteBg = 0xffffff;    // Idle/menu background
constexpr uint32_t kColorLightGray = 0xf0f0f0;  // Status bar on white bg
constexpr uint32_t kColorGreen = 0x4CAF50;      // Active session background
constexpr uint32_t kColorRed = 0xF44336;        // Denied background

// Button pill colors
constexpr uint32_t kColorBlue = 0x2196F3;       // Selected menu item
constexpr uint32_t kColorYellow = 0xFFD600;     // Menu/back button bg
constexpr uint32_t kColorBtnGreen = 0x4CAF50;   // Select button bg
constexpr uint32_t kColorBtnRed = 0xF44336;     // Stop button bg

// Text on light backgrounds
constexpr uint32_t kColorDarkText = 0x212121;   // Dark text on light bg

// Layout constants
constexpr int kPadding = 8;
constexpr int kPaddingLg = 16;
constexpr int kBorderWidth = 1;
constexpr int kRadius = 4;

/// Darken an RGB color by multiplying each channel by (256 - factor) / 256.
/// factor=0 means no change, factor=51 means ~80% brightness.
constexpr uint32_t DarkenColor(uint32_t rgb, uint8_t factor = 51) {
  uint32_t r = (rgb >> 16) & 0xFF;
  uint32_t g = (rgb >> 8) & 0xFF;
  uint32_t b = rgb & 0xFF;
  uint32_t scale = 256 - factor;
  r = (r * scale) >> 8;
  g = (g * scale) >> 8;
  b = (b * scale) >> 8;
  return (r << 16) | (g << 8) | b;
}

/// Returns true if the color is "light" (perceived brightness > threshold).
constexpr bool IsLightColor(uint32_t rgb) {
  uint32_t r = (rgb >> 16) & 0xFF;
  uint32_t g = (rgb >> 8) & 0xFF;
  uint32_t b = rgb & 0xFF;
  // Weighted luminance approximation (BT.601)
  uint32_t luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 128;
}

}  // namespace maco::terminal_ui::theme
