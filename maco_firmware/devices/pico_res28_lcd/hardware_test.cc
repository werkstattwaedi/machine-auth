// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// On-device test for ST7789 display initialization and rendering.
// Self-contained test that creates hardware instances directly.

#include <cstring>

#include "delay_hal.h"
#include "lvgl.h"
#include "maco_firmware/devices/pico_res28_lcd/pico_res28_lcd_driver.h"
#include "pb_digital_io/digital_io.h"
#include "pb_spi/initiator.h"
#include "pinmap_hal.h"
#include "pw_log/log.h"
#include "pw_unit_test/framework.h"
#include "timer_hal.h"

namespace {

// Pin definitions for Pico-ResTouch-LCD-2.8 display
constexpr hal_pin_t kPinDisplayReset = S3;
constexpr hal_pin_t kPinDisplayChipSelect = D5;
constexpr hal_pin_t kPinDisplayDataCommand = D10;
constexpr hal_pin_t kPinDisplayBacklight = A5;

// SPI clock frequency for display (40 MHz typical for ST7789)
constexpr uint32_t kDisplaySpiClockHz = 40'000'000;

// Manual tick for deterministic test timing - forces LVGL to render every frame
uint32_t g_manual_tick = 0;
uint32_t GetManualTick() { return g_manual_tick; }
void ManualDelayMs([[maybe_unused]] uint32_t ms) {
  // No-op - we control time manually in tests
}

#if LV_USE_LOG
// LVGL log callback - forward to PW_LOG
void LvglLogCallback([[maybe_unused]] lv_log_level_t level, const char* buf) {
  size_t len = strlen(buf);
  if (len > 0 && buf[len - 1] == '\n') {
    char tmp[256];
    size_t copy_len = len - 1 < sizeof(tmp) - 1 ? len - 1 : sizeof(tmp) - 1;
    memcpy(tmp, buf, copy_len);
    tmp[copy_len] = '\0';
    PW_LOG_INFO("[LVGL] %s", tmp);
  } else {
    PW_LOG_INFO("[LVGL] %s", buf);
  }
}
#endif

// Create hardware instances (singleton pattern for test lifetime)
maco::display::PicoRes28LcdDriver& GetDriver() {
  static pb::ParticleDigitalOut rst_pin(kPinDisplayReset);
  static pb::ParticleDigitalOut cs_pin(kPinDisplayChipSelect);
  static pb::ParticleDigitalOut dc_pin(kPinDisplayDataCommand);
  static pb::ParticleDigitalOut bl_pin(kPinDisplayBacklight);

  static pb::ParticleSpiInitiator spi_initiator(
      pb::ParticleSpiInitiator::Interface::kSpi1, kDisplaySpiClockHz
  );

  static maco::display::PicoRes28LcdDriver driver(
      spi_initiator, cs_pin, dc_pin, rst_pin, bl_pin
  );
  return driver;
}

class DisplayTest : public ::testing::Test {
 protected:
  void SetUp() override {
    PW_LOG_INFO("=== DisplayTest::SetUp ===");

    // Initialize LVGL once with manual tick control
    if (!lvgl_initialized_) {
      PW_LOG_INFO("Calling lv_init()");
      lv_init();
      lv_tick_set_cb(GetManualTick);
      lv_delay_set_cb(ManualDelayMs);
#if LV_USE_LOG
      lv_log_register_print_cb(LvglLogCallback);
#endif
      lvgl_initialized_ = true;
      PW_LOG_INFO("LVGL initialized with manual tick");
    }

    // Reset tick at start of each test
    g_manual_tick = 0;
  }

  void TearDown() override {
    lv_obj_t* screen = lv_screen_active();
    if (screen != nullptr) {
      lv_obj_clean(screen);
    }
  }

  // Advance tick and run one frame
  void RunFrame() {
    g_manual_tick += 33;  // ~30 FPS
    lv_timer_handler();
  }

  static bool lvgl_initialized_;
};

bool DisplayTest::lvgl_initialized_ = false;

TEST_F(DisplayTest, DriverInitSucceeds) {
  auto& driver = GetDriver();

  PW_LOG_INFO("Calling driver.Init()");
  auto status = driver.Init();
  ASSERT_TRUE(status.ok()) << "Driver Init failed";
  PW_LOG_INFO("driver.Init() succeeded");
}

TEST_F(DisplayTest, CreateLvglDisplaySucceeds) {
  auto& driver = GetDriver();

  auto init_status = driver.Init();
  ASSERT_TRUE(init_status.ok()) << "Driver Init failed";

  PW_LOG_INFO("Calling CreateLvglDisplay()");
  auto result = driver.CreateLvglDisplay();
  ASSERT_TRUE(result.ok()) << "CreateLvglDisplay failed";
  PW_LOG_INFO("CreateLvglDisplay() succeeded");

  lv_display_t* display = *result;
  EXPECT_NE(display, nullptr);
  EXPECT_EQ(lv_display_get_horizontal_resolution(display), 240);
  EXPECT_EQ(lv_display_get_vertical_resolution(display), 320);
}

TEST_F(DisplayTest, RenderColorGradients) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());
  ASSERT_TRUE(driver.CreateLvglDisplay().ok());

  lv_obj_t* screen = lv_screen_active();
  lv_obj_set_style_bg_color(screen, lv_color_black(), LV_PART_MAIN);

  // 7 gradient bands: R, Y, G, C, B, M, Gray
  constexpr int kBandHeight = 320 / 7;
  constexpr int kWidth = 240;

  const lv_color_t colors[] = {
      lv_color_hex(0xFF0000),  // Red
      lv_color_hex(0xFFFF00),  // Yellow
      lv_color_hex(0x00FF00),  // Green
      lv_color_hex(0x00FFFF),  // Cyan
      lv_color_hex(0x0000FF),  // Blue
      lv_color_hex(0xFF00FF),  // Magenta
      lv_color_hex(0xFFFFFF),  // White (grayscale)
  };

  for (int i = 0; i < 7; i++) {
    lv_obj_t* band = lv_obj_create(screen);
    lv_obj_remove_style_all(band);
    lv_obj_set_size(band, kWidth, kBandHeight);
    lv_obj_set_pos(band, 0, i * kBandHeight);

    lv_obj_set_style_bg_opa(band, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(band, lv_color_black(), 0);
    lv_obj_set_style_bg_grad_color(band, colors[i], 0);
    lv_obj_set_style_bg_grad_dir(band, LV_GRAD_DIR_HOR, 0);
  }

  PW_LOG_INFO("Rendering 7 gradient bands...");
  PW_LOG_INFO("Top to bottom: Red, Yellow, Green, Cyan, Blue, Magenta, Gray");

  RunFrame();

  PW_LOG_INFO("Gradient render complete");
}

TEST_F(DisplayTest, PerfTestSmallRegion) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());
  ASSERT_TRUE(driver.CreateLvglDisplay().ok());

  lv_obj_t* screen = lv_screen_active();
  lv_obj_set_style_bg_color(screen, lv_color_black(), LV_PART_MAIN);

  // Small 10x10 pixel object that changes color
  lv_obj_t* pixel = lv_obj_create(screen);
  lv_obj_remove_style_all(pixel);
  lv_obj_set_size(pixel, 10, 10);
  lv_obj_set_pos(pixel, 0, 0);
  lv_obj_set_style_bg_opa(pixel, LV_OPA_COVER, 0);

  constexpr uint32_t kFrameCount = 100;

  PW_LOG_INFO(
      "Running small region (10x10) test for %lu frames...",
      static_cast<unsigned long>(kFrameCount)
  );

  uint32_t total_render_time = 0;
  uint32_t min_render_time = UINT32_MAX;
  uint32_t max_render_time = 0;
  uint8_t hue = 0;

  for (uint32_t i = 0; i < kFrameCount; i++) {
    lv_obj_set_style_bg_color(pixel, lv_color_hsv_to_rgb(hue, 100, 100), 0);
    hue += 2;

    lv_obj_invalidate(pixel);
    g_manual_tick += 33;

    uint32_t frame_start = hal_timer_millis(nullptr);
    lv_timer_handler();
    uint32_t render_time = hal_timer_millis(nullptr) - frame_start;

    total_render_time += render_time;
    if (render_time < min_render_time)
      min_render_time = render_time;
    if (render_time > max_render_time)
      max_render_time = render_time;
  }

  uint32_t avg_render_time = total_render_time / kFrameCount;
  uint32_t max_fps = avg_render_time > 0 ? 1000 / avg_render_time : 0;

  PW_LOG_INFO(
      "Small region (10x10): %lu frames in %lu ms",
      static_cast<unsigned long>(kFrameCount),
      static_cast<unsigned long>(total_render_time)
  );
  PW_LOG_INFO(
      "  Render time: min=%lu ms, avg=%lu ms, max=%lu ms",
      static_cast<unsigned long>(min_render_time),
      static_cast<unsigned long>(avg_render_time),
      static_cast<unsigned long>(max_render_time)
  );
  PW_LOG_INFO("  Max achievable FPS: %lu", static_cast<unsigned long>(max_fps));
}

TEST_F(DisplayTest, PerfTestFullScreen) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());
  ASSERT_TRUE(driver.CreateLvglDisplay().ok());

  lv_obj_t* screen = lv_screen_active();

  constexpr uint32_t kFrameCount = 30;

  PW_LOG_INFO(
      "Running full-screen (240x320) test for %lu frames...",
      static_cast<unsigned long>(kFrameCount)
  );

  uint32_t total_render_time = 0;
  uint32_t min_render_time = UINT32_MAX;
  uint32_t max_render_time = 0;
  uint8_t hue = 0;

  for (uint32_t i = 0; i < kFrameCount; i++) {
    lv_obj_set_style_bg_color(
        screen, lv_color_hsv_to_rgb(hue, 100, 100), LV_PART_MAIN
    );
    hue += 5;

    lv_obj_invalidate(screen);
    g_manual_tick += 33;

    uint32_t frame_start = hal_timer_millis(nullptr);
    lv_timer_handler();
    uint32_t render_time = hal_timer_millis(nullptr) - frame_start;

    total_render_time += render_time;
    if (render_time < min_render_time)
      min_render_time = render_time;
    if (render_time > max_render_time)
      max_render_time = render_time;
  }

  uint32_t avg_render_time = total_render_time / kFrameCount;
  uint32_t max_fps = avg_render_time > 0 ? 1000 / avg_render_time : 0;

  PW_LOG_INFO(
      "Full-screen (240x320): %lu frames in %lu ms",
      static_cast<unsigned long>(kFrameCount),
      static_cast<unsigned long>(total_render_time)
  );
  PW_LOG_INFO(
      "  Render time: min=%lu ms, avg=%lu ms, max=%lu ms",
      static_cast<unsigned long>(min_render_time),
      static_cast<unsigned long>(avg_render_time),
      static_cast<unsigned long>(max_render_time)
  );
  PW_LOG_INFO("  Max achievable FPS: %lu", static_cast<unsigned long>(max_fps));
}

TEST_F(DisplayTest, StressTestFullScreen) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());
  ASSERT_TRUE(driver.CreateLvglDisplay().ok());

  lv_obj_t* screen = lv_screen_active();

  // 5 minute stress test
  constexpr uint32_t kTestDurationMs = 5 * 60 * 1000;
  constexpr uint32_t kStatsIntervalMs = 1000;

  // High contrast colors for easy hang detection
  const lv_color_t colors[] = {
      lv_color_hex(0xFF0000),  // Red
      lv_color_hex(0x00FFFF),  // Cyan (complement)
      lv_color_hex(0x00FF00),  // Green
      lv_color_hex(0xFF00FF),  // Magenta (complement)
      lv_color_hex(0x0000FF),  // Blue
      lv_color_hex(0xFFFF00),  // Yellow (complement)
      lv_color_hex(0xFFFFFF),  // White
      lv_color_hex(0x000000),  // Black
  };
  constexpr size_t kNumColors = sizeof(colors) / sizeof(colors[0]);

  PW_LOG_INFO("=== STRESS TEST: 5 minutes full-screen at max speed ===");
  PW_LOG_INFO("Statistics every second. Watch for hangs!");

  uint32_t test_start = hal_timer_millis(nullptr);
  uint32_t stats_start = test_start;
  uint32_t total_frames = 0;
  uint32_t interval_frames = 0;
  uint32_t interval_render_time = 0;
  uint32_t color_index = 0;

  while (hal_timer_millis(nullptr) - test_start < kTestDurationMs) {
    // Alternate between high-contrast colors
    lv_obj_set_style_bg_color(screen, colors[color_index], LV_PART_MAIN);
    color_index = (color_index + 1) % kNumColors;

    lv_obj_invalidate(screen);
    g_manual_tick += 33;

    uint32_t frame_start = hal_timer_millis(nullptr);
    lv_timer_handler();
    uint32_t render_time = hal_timer_millis(nullptr) - frame_start;

    interval_render_time += render_time;
    interval_frames++;
    total_frames++;

    // Print stats every second
    uint32_t now = hal_timer_millis(nullptr);
    if (now - stats_start >= kStatsIntervalMs) {
      uint32_t elapsed_sec = (now - test_start) / 1000;
      uint32_t remaining_sec = (kTestDurationMs - (now - test_start)) / 1000;
      uint32_t avg_ms =
          interval_frames > 0 ? interval_render_time / interval_frames : 0;
      uint32_t fps = interval_frames * 1000 / (now - stats_start);

      PW_LOG_INFO(
          "[%lu s] frames=%lu fps=%lu avg=%lu ms (remaining %lu s)",
          static_cast<unsigned long>(elapsed_sec),
          static_cast<unsigned long>(interval_frames),
          static_cast<unsigned long>(fps),
          static_cast<unsigned long>(avg_ms),
          static_cast<unsigned long>(remaining_sec)
      );

      // Reset interval counters
      stats_start = now;
      interval_frames = 0;
      interval_render_time = 0;
    }
  }

  uint32_t total_elapsed = hal_timer_millis(nullptr) - test_start;
  PW_LOG_INFO("=== STRESS TEST COMPLETE ===");
  PW_LOG_INFO(
      "Total: %lu frames in %lu ms (%lu FPS avg)",
      static_cast<unsigned long>(total_frames),
      static_cast<unsigned long>(total_elapsed),
      static_cast<unsigned long>(total_frames * 1000 / total_elapsed)
  );
}

}  // namespace
