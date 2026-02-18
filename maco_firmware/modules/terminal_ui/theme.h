// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

namespace maco::terminal_ui::theme {

// Brand colors (adapted from web app for white-on-dark terminal display)
constexpr uint32_t kColorBg = 0x1a1a2e;        // Dark navy background
constexpr uint32_t kColorCard = 0x252540;       // Panel/card background
constexpr uint32_t kColorBorder = 0x3a3a5c;     // Subtle borders
constexpr uint32_t kColorText = 0xffffff;       // Primary text
constexpr uint32_t kColorMuted = 0x888888;      // Secondary text
constexpr uint32_t kColorTeal = 0x4dbdc6;       // Primary accent
constexpr uint32_t kColorTealDark = 0x3aa8b1;   // Pressed accent
constexpr uint32_t kColorGold = 0xffde80;       // Warm accent (logo underline)
constexpr uint32_t kColorGoldDark = 0xe6b800;   // Emphasis accent
constexpr uint32_t kColorError = 0xe57373;      // Error/warning
constexpr uint32_t kColorSuccess = 0x81c784;    // Success/confirmed

// Layout constants
constexpr int kPadding = 8;
constexpr int kPaddingLg = 16;
constexpr int kBorderWidth = 1;
constexpr int kRadius = 4;

}  // namespace maco::terminal_ui::theme
