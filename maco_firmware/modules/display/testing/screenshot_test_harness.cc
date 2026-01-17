// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/display/testing/screenshot_test_harness.h"

#include <cstdlib>

#include "lvgl.h"
#include "pw_log/log.h"
#include "pw_status/try.h"

namespace maco::display::testing {

namespace {

// Global tick counter for LVGL's tick callback
uint32_t g_tick_ms = 0;

// Track whether LVGL has been initialized globally
bool g_lvgl_initialized = false;

uint32_t LvglTickCb() { return g_tick_ms; }

}  // namespace

ScreenshotTestHarness::~ScreenshotTestHarness() {
  // Note: We intentionally don't call lv_deinit() because LVGL doesn't
  // support re-initialization after deinit. For tests, we let the process
  // exit handle cleanup.
}

pw::Status ScreenshotTestHarness::Init() {
  if (initialized_) {
    return pw::Status::FailedPrecondition();
  }

  // Initialize LVGL once globally (it doesn't support re-initialization)
  if (!g_lvgl_initialized) {
    lv_init();
    lv_tick_set_cb(LvglTickCb);
    g_lvgl_initialized = true;
  }

  // Initialize display driver
  PW_TRY(display_driver_.Init());

  // Create LVGL display
  auto result = display_driver_.CreateLvglDisplay();
  if (!result.ok()) {
    return result.status();
  }

  initialized_ = true;
  g_tick_ms = 0;
  tick_ms_ = 0;

  return pw::OkStatus();
}

pw::Status ScreenshotTestHarness::ActivateScreen(ui::Screen& screen) {
  if (!initialized_) {
    return pw::Status::FailedPrecondition();
  }

  PW_TRY(screen.OnActivate());

  if (screen.lv_screen() != nullptr) {
    lv_screen_load(screen.lv_screen());
  }

  return pw::OkStatus();
}

void ScreenshotTestHarness::RenderFrame(uint32_t tick_ms) {
  tick_ms_ += tick_ms;
  g_tick_ms = tick_ms_;
  lv_timer_handler();
}

uint32_t ScreenshotTestHarness::GetTickMs() { return g_tick_ms; }

PngImage ScreenshotTestHarness::CaptureScreenshot() const {
  return PngImage::FromRgb565(display_driver_.framebuffer(),
                              ScreenshotDisplayDriver::kWidth,
                              ScreenshotDisplayDriver::kHeight);
}

bool ScreenshotTestHarness::CompareToGolden(const std::string& golden_path,
                                            const std::string& diff_path) {
  const char* workspace_dir = std::getenv("BUILD_WORKSPACE_DIRECTORY");
  const char* update_goldens = std::getenv("UPDATE_GOLDENS");

  PngImage actual = CaptureScreenshot();

  // Build full path to golden file
  std::string full_golden_path;
  if (workspace_dir != nullptr) {
    full_golden_path = std::string(workspace_dir) + "/" + golden_path;
  } else {
    // In bazel test, use runfiles path
    full_golden_path = golden_path;
  }

  // Update mode: write current screenshot as new golden
  if (update_goldens != nullptr && workspace_dir != nullptr) {
    std::string update_path =
        std::string(workspace_dir) + "/" + golden_path;
    pw::Status status = actual.SaveToFile(update_path);
    if (status.ok()) {
      PW_LOG_INFO("Updated golden: %s", update_path.c_str());
      return true;
    } else {
      PW_LOG_ERROR("Failed to update golden: %s", update_path.c_str());
      return false;
    }
  }

  // Compare mode: load golden and compare
  auto golden_result = PngImage::LoadFromFile(full_golden_path);
  if (!golden_result.ok()) {
    PW_LOG_ERROR("Failed to load golden image: %s", full_golden_path.c_str());

    // Save actual screenshot for debugging
    if (!diff_path.empty()) {
      (void)actual.SaveToFile(diff_path);
      PW_LOG_INFO("Saved actual screenshot to: %s", diff_path.c_str());
    }

    return false;
  }

  PngImage diff;
  bool matches = actual.Compare(*golden_result, &diff);

  if (!matches && !diff_path.empty()) {
    (void)diff.SaveToFile(diff_path);
    PW_LOG_INFO("Images differ. Diff saved to: %s", diff_path.c_str());
  }

  return matches;
}

}  // namespace maco::display::testing
