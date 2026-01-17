// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <string>

#include "maco_firmware/modules/display/testing/png_image.h"
#include "maco_firmware/modules/display/testing/screenshot_display_driver.h"
#include "maco_firmware/modules/ui/screen.h"
#include "pw_status/status.h"

namespace maco::display::testing {

/// Test harness for LVGL screenshot testing.
/// Provides single-threaded, deterministic LVGL rendering.
///
/// Example usage:
/// @code
///   ScreenshotTestHarness harness;
///   ASSERT_EQ(harness.Init(), pw::OkStatus());
///
///   MyScreen screen;
///   harness.ActivateScreen(screen);
///   harness.RenderFrame();
///
///   EXPECT_TRUE(harness.CompareToGolden("testdata/expected.png"));
/// @endcode
class ScreenshotTestHarness {
 public:
  ScreenshotTestHarness() = default;
  ~ScreenshotTestHarness();

  // Non-copyable, non-movable
  ScreenshotTestHarness(const ScreenshotTestHarness&) = delete;
  ScreenshotTestHarness& operator=(const ScreenshotTestHarness&) = delete;

  /// Initialize LVGL and the screenshot display driver.
  /// Must be called before other methods.
  pw::Status Init();

  /// Activate a screen for testing.
  /// Calls OnActivate() and loads the screen into LVGL.
  pw::Status ActivateScreen(ui::Screen& screen);

  /// Advance LVGL time and render a frame.
  /// @param tick_ms Time to advance in milliseconds (default: 1 frame at 60fps)
  void RenderFrame(uint32_t tick_ms = 17);

  /// Compare current framebuffer to a golden PNG image.
  /// @param golden_path Path to golden image (relative to workspace root)
  /// @param diff_path Optional path to save diff image on mismatch
  /// @return true if images match
  ///
  /// If UPDATE_GOLDENS=1 environment variable is set and running via
  /// `bazel run`, the golden file will be updated instead of compared.
  bool CompareToGolden(const std::string& golden_path,
                       const std::string& diff_path = "");

  /// Get current framebuffer as PNG image.
  PngImage CaptureScreenshot() const;

  /// Access the display driver directly.
  ScreenshotDisplayDriver& display_driver() { return display_driver_; }

 private:
  static uint32_t GetTickMs();

  ScreenshotDisplayDriver display_driver_;
  uint32_t tick_ms_ = 0;
  bool initialized_ = false;
};

}  // namespace maco::display::testing
