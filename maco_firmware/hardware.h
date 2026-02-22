// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>

/// @file hardware.h
/// @brief Physical hardware layout constants for the MACO terminal.
///
/// Enumerates named physical positions for LEDs, buttons, and other
/// terminal components. Independent of any driver or animation layer.

namespace maco {

/// Physical button positions on the MACO terminal front panel.
///
///   [top-left]     [top-right]
///
///   [bottom-left]  [bottom-right]
enum class Button {
  kTopLeft = 0,
  kTopRight = 1,
  kBottomLeft = 2,
  kBottomRight = 3,
};

static constexpr int kButtonCount = 4;

/// All buttons in index order, for ranging over every button.
static constexpr std::array<Button, kButtonCount> kAllButtons = {
    Button::kTopLeft,
    Button::kTopRight,
    Button::kBottomLeft,
    Button::kBottomRight,
};

}  // namespace maco
