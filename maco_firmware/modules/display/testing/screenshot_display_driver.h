// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <memory>
#include <vector>

#include "maco_firmware/modules/display/display_driver.h"
#include "pw_span/span.h"

namespace maco::display::testing {

/// Display driver that captures frames to an in-memory framebuffer.
/// Used for screenshot testing without SDL or real hardware.
/// Buffers are heap-allocated to avoid bloating test fixture size.
class ScreenshotDisplayDriver : public DisplayDriver {
 public:
  /// Display dimensions (same as hardware)
  static constexpr uint16_t kWidth = 240;
  static constexpr uint16_t kHeight = 320;

  ScreenshotDisplayDriver() = default;
  ~ScreenshotDisplayDriver() override;

  pw::Status Init() override;
  pw::Result<lv_display_t*> CreateLvglDisplay() override;

  uint16_t width() const override { return kWidth; }
  uint16_t height() const override { return kHeight; }

  /// Get the accumulated framebuffer (RGB565 format).
  pw::span<const uint16_t> framebuffer() const;

  /// Clear the framebuffer to black.
  void ClearFramebuffer();

 private:
  static void FlushCallback(lv_display_t* disp,
                            const lv_area_t* area,
                            uint8_t* px_map);
  void Flush(const lv_area_t* area, const uint16_t* px_map);

  lv_display_t* display_ = nullptr;

  // Heap-allocated buffers (allocated in Init)
  static constexpr size_t kFramebufferSize = kWidth * kHeight;
  static constexpr size_t kBufferLines = 40;
  static constexpr size_t kDrawBufferSize = kWidth * kBufferLines;

  std::unique_ptr<uint16_t[]> framebuffer_;
  std::unique_ptr<uint16_t[]> draw_buf1_;
  std::unique_ptr<uint16_t[]> draw_buf2_;
};

}  // namespace maco::display::testing
