// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <mutex>

#include "maco_firmware/modules/display/display_driver.h"

// Forward declarations for SDL types
struct SDL_Window;
struct SDL_Renderer;
struct SDL_Texture;

namespace maco::display {

// SDL-based display driver for host simulator.
// Renders the LVGL display overlaid on a photo of the real hardware,
// and provides button hit-testing for mouse click input.
class SdlDisplayDriver : public DisplayDriver {
 public:
  /// Display dimensions (same as hardware for consistent UI)
  static constexpr uint16_t kWidth = 240;
  static constexpr uint16_t kHeight = 320;

  /// Background image dimensions (MacoTerminal.png native resolution)
  static constexpr int kWindowWidth = 607;
  static constexpr int kWindowHeight = 1094;

  /// Offset of the LVGL display within the background image
  static constexpr int kDisplayOffsetX = 187;
  static constexpr int kDisplayOffsetY = 274;

  /// Button regions in image coordinates (for mouse hit-testing)
  struct ButtonRegion {
    int x1, y1, x2, y2;
    uint32_t lv_key;
  };

  static constexpr ButtonRegion kButtons[] = {
      {146, 120, 270, 198, LV_KEY_PREV},   // Top-left (Up)
      {340, 120, 465, 198, LV_KEY_NEXT},   // Top-right (Down)
      {153, 628, 258, 717, LV_KEY_ENTER},  // Bottom-left (OK)
      {357, 628, 461, 717, LV_KEY_ESC},    // Bottom-right (Cancel)
  };

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

  /// Test if (x, y) in logical image coordinates hits a button.
  /// Returns the LVGL key code, or 0 if no button was hit.
  uint32_t HitTestButton(int x, int y) const;

  /// Returns the SDL renderer (for coordinate conversion in input driver)
  SDL_Renderer* renderer() const { return renderer_; }

 private:
  static void FlushCallback(lv_display_t* disp,
                             const lv_area_t* area,
                             uint8_t* px_map);
  void Flush(const lv_area_t* area, uint8_t* px_map);

  bool LoadBackgroundImage();

  lv_display_t* display_ = nullptr;
  SDL_Window* window_ = nullptr;
  SDL_Renderer* renderer_ = nullptr;
  SDL_Texture* texture_ = nullptr;
  SDL_Texture* bg_texture_ = nullptr;
  bool quit_requested_ = false;

  // Draw buffers (heap allocated in CreateLvglDisplay)
  static constexpr size_t kBufferLines = 40;
  void* draw_buf1_ = nullptr;
  void* draw_buf2_ = nullptr;

  // Mutex to protect SDL texture operations between render and main threads
  std::mutex texture_mutex_;
};

}  // namespace maco::display
