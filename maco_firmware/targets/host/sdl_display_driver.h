// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/display/display_driver.h"

namespace maco::display {

// SDL-based display driver for host simulator
// TODO: Implement when SDL2 Bazel dependency is configured
class SdlDisplayDriver : public DisplayDriver {
 public:
  /// Display dimensions (same as hardware for consistent UI)
  static constexpr uint16_t kWidth = 240;
  static constexpr uint16_t kHeight = 320;

  SdlDisplayDriver() = default;
  ~SdlDisplayDriver() override = default;

  pw::Status Init() override;
  pw::Result<lv_display_t*> CreateLvglDisplay() override;

  uint16_t width() const override { return kWidth; }
  uint16_t height() const override { return kHeight; }

 private:
  static void FlushCallback(lv_display_t* disp,
                            const lv_area_t* area,
                            uint8_t* px_map);
  void Flush(const lv_area_t* area, uint8_t* px_map);

  lv_display_t* display_ = nullptr;

  // Draw buffers (1/10 of screen, double buffered)
  static constexpr size_t kBufferLines = 32;  // ~1/10 of 320
  uint8_t draw_buf1_[kWidth * kBufferLines * 2];  // RGB565
  uint8_t draw_buf2_[kWidth * kBufferLines * 2];
};

}  // namespace maco::display
