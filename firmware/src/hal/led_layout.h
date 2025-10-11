#pragma once

#include <cstdint>

namespace oww::hal {

/**
 * @brief LED layout constants for the MACO hardware
 *
 * LED indices for the 16-pixel WS2812 strip:
 * - Buttons: indices for the four physical buttons
 * - NFC area: indices for NFC backlight
 * - Ring: indices for display surround ring
 */
namespace led_indices {

// Button LED indices [top_left, top_right, bottom_left, bottom_right]
constexpr uint8_t BUTTON_TOP_LEFT = 10;
constexpr uint8_t BUTTON_TOP_RIGHT = 11;
constexpr uint8_t BUTTON_BOTTOM_LEFT = 4;
constexpr uint8_t BUTTON_BOTTOM_RIGHT = 1;

// NFC area backlight
constexpr uint8_t NFC_LEFT = 2;
constexpr uint8_t NFC_RIGHT = 3;

// Ring indices (clockwise from bottom-right)
constexpr uint8_t RING_INDICES[] = {0, 15, 14, 13, 12, 9, 8, 7, 6, 5};
constexpr uint8_t RING_COUNT = 10;

}  // namespace led_indices

}  // namespace oww::hal
