// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <mutex>

#include "maco_firmware/modules/display/display_driver.h"

// Forward declarations for SDL types
struct SDL_Window;
struct SDL_Renderer;
struct SDL_Texture;

namespace maco::display {

// SDL-based display driver for host simulator
class SdlDisplayDriver : public DisplayDriver {
 public:
  /// Display dimensions (same as hardware for consistent UI)
  static constexpr uint16_t kWidth = 240;
  static constexpr uint16_t kHeight = 320;

  /// Window scale factor for better visibility on desktop
  static constexpr int kScale = 2;

  SdlDisplayDriver() = default;
  ~SdlDisplayDriver() override;

  pw::Status Init() override;
  pw::Result<lv_display_t*> CreateLvglDisplay() override;

  uint16_t width() const override { return kWidth; }
  uint16_t height() const override { return kHeight; }

  /// Pump SDL events (call periodically to handle window close, etc.)
  void PumpEvents();

  /// Present the frame to screen (call after lv_timer_handler)
  void Present();

  /// Returns true if window close was requested
  bool quit_requested() const { return quit_requested_; }

 private:
  static void FlushCallback(lv_display_t* disp,
                            const lv_area_t* area,
                            uint8_t* px_map);
  void Flush(const lv_area_t* area, uint8_t* px_map);

  lv_display_t* display_ = nullptr;
  SDL_Window* window_ = nullptr;
  SDL_Renderer* renderer_ = nullptr;
  SDL_Texture* texture_ = nullptr;
  bool quit_requested_ = false;

  // Draw buffers (heap allocated in CreateLvglDisplay)
  static constexpr size_t kBufferLines = 40;
  void* draw_buf1_ = nullptr;
  void* draw_buf2_ = nullptr;

  // Mutex to protect SDL texture operations between render and main threads
  std::mutex texture_mutex_;
};

}  // namespace maco::display
