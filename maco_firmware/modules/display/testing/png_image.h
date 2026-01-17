// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "pw_result/result.h"
#include "pw_span/span.h"
#include "pw_status/status.h"

namespace maco::display::testing {

/// PNG image for screenshot testing.
/// Stores pixel data in RGB888 format internally.
class PngImage {
 public:
  PngImage() = default;
  PngImage(uint32_t width, uint32_t height);

  /// Create from RGB565 framebuffer (converts to RGB888).
  static PngImage FromRgb565(pw::span<const uint16_t> framebuffer,
                             uint32_t width,
                             uint32_t height);

  /// Load from PNG file.
  static pw::Result<PngImage> LoadFromFile(const std::string& path);

  /// Save to PNG file.
  pw::Status SaveToFile(const std::string& path) const;

  /// Compare with another image.
  /// @param other Image to compare against
  /// @param diff_out Optional output for diff visualization (red = different)
  /// @return true if images are identical
  bool Compare(const PngImage& other, PngImage* diff_out = nullptr) const;

  uint32_t width() const { return width_; }
  uint32_t height() const { return height_; }
  bool empty() const { return pixels_.empty(); }

  /// Access raw RGB888 pixel data (3 bytes per pixel, row-major).
  const std::vector<uint8_t>& pixels() const { return pixels_; }

 private:
  uint32_t width_ = 0;
  uint32_t height_ = 0;
  std::vector<uint8_t> pixels_;  // RGB888 format
};

/// Convert RGB565 pixel to RGB888 components.
inline void Rgb565ToRgb888(uint16_t rgb565,
                           uint8_t& r,
                           uint8_t& g,
                           uint8_t& b) {
  // RGB565: RRRRR GGGGGG BBBBB
  r = static_cast<uint8_t>((rgb565 >> 11) << 3);
  g = static_cast<uint8_t>(((rgb565 >> 5) & 0x3F) << 2);
  b = static_cast<uint8_t>((rgb565 & 0x1F) << 3);
}

}  // namespace maco::display::testing
