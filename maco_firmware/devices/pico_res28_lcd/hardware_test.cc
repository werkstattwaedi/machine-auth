// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// On-device test for ST7789 display initialization and rendering.
// Self-contained test that creates hardware instances directly.

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

// LVGL tick callback
uint32_t GetMillisSinceBoot() {
  return static_cast<uint32_t>(hal_timer_millis(nullptr));
}

// LVGL delay callback
void DelayMs(uint32_t ms) { HAL_Delay_Milliseconds(ms); }

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

    // Initialize LVGL once
    if (!lvgl_initialized_) {
      PW_LOG_INFO("Calling lv_init()");
      lv_init();
      lv_tick_set_cb(GetMillisSinceBoot);
      lv_delay_set_cb(DelayMs);
      lvgl_initialized_ = true;
      PW_LOG_INFO("LVGL initialized");
    }
  }

  void TearDown() override {
    // Clean up all objects created on the screen
    lv_obj_t* screen = lv_screen_active();
    if (screen != nullptr) {
      lv_obj_clean(screen);
    }
  }

  static bool lvgl_initialized_;
};

bool DisplayTest::lvgl_initialized_ = false;

TEST_F(DisplayTest, DriverInitSucceeds) {
  PW_LOG_INFO("=== Test: DriverInitSucceeds ===");

  auto& driver = GetDriver();

  PW_LOG_INFO("Calling driver.Init()");
  auto status = driver.Init();
  ASSERT_TRUE(status.ok()) << "Driver Init failed";
  PW_LOG_INFO("driver.Init() succeeded");
}

TEST_F(DisplayTest, CreateLvglDisplaySucceeds) {
  PW_LOG_INFO("=== Test: CreateLvglDisplaySucceeds ===");

  auto& driver = GetDriver();

  // Initialize if not already done
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
  PW_LOG_INFO("=== Test: RenderColorGradients ===");

  auto& driver = GetDriver();

  // Initialize and create display
  auto init_status = driver.Init();
  ASSERT_TRUE(init_status.ok());

  auto result = driver.CreateLvglDisplay();
  ASSERT_TRUE(result.ok());

  lv_obj_t* screen = lv_screen_active();
  lv_obj_set_style_bg_color(screen, lv_color_black(), LV_PART_MAIN);

  // 7 gradient bands: R, Y, G, C, B, M, Gray
  // Display is 240x320, so each band is ~45 pixels tall
  constexpr int kBandHeight = 320 / 7;
  constexpr int kWidth = 240;

  // Colors for gradients (black -> color)
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

    // Set gradient from black to color
    lv_obj_set_style_bg_opa(band, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(band, lv_color_black(), 0);
    lv_obj_set_style_bg_grad_color(band, colors[i], 0);
    lv_obj_set_style_bg_grad_dir(band, LV_GRAD_DIR_HOR, 0);
  }

  PW_LOG_INFO("Render complete - should show 7 horizontal gradient bands");
  PW_LOG_INFO("Top to bottom: Red, Yellow, Green, Cyan, Blue, Magenta, Gray");
  PW_LOG_INFO("Each band: black on left -> full color on right");
  // Run LVGL timer to trigger rendering
  for (int i = 0; i < 30; i++) {
    lv_timer_handler();
    HAL_Delay_Milliseconds(50);
  }
}

TEST_F(DisplayTest, PerfTestSinglePixel) {
  PW_LOG_INFO("=== Test: PerfTestSinglePixel ===");

  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());
  ASSERT_TRUE(driver.CreateLvglDisplay().ok());

  lv_obj_t* screen = lv_screen_active();
  lv_obj_set_style_bg_color(screen, lv_color_black(), LV_PART_MAIN);

  // Small 10x10 pixel object that changes color
  lv_obj_t* pixel = lv_obj_create(screen);
  lv_obj_remove_style_all(pixel);
  lv_obj_set_size(pixel, 10, 10);
  lv_obj_set_pos(pixel, 115, 155);  // Center-ish
  lv_obj_set_style_bg_opa(pixel, LV_OPA_COVER, 0);

  PW_LOG_INFO("Running single-pixel update test for 2 seconds...");

  uint32_t start_time = hal_timer_millis(nullptr);
  uint32_t frame_count = 0;
  uint8_t hue = 0;

  while (hal_timer_millis(nullptr) - start_time < 2000) {
    // Change pixel color each frame
    lv_obj_set_style_bg_color(pixel, lv_color_hsv_to_rgb(hue, 100, 100), 0);
    hue += 5;

    uint32_t wait_ms = lv_timer_handler();
    if (wait_ms > 0) {
      HAL_Delay_Milliseconds(wait_ms);
    }
    frame_count++;
  }

  uint32_t elapsed = hal_timer_millis(nullptr) - start_time;
  uint32_t fps = (frame_count * 1000) / elapsed;

  PW_LOG_INFO("Single-pixel: %lu frames in %lu ms = %lu FPS",
              static_cast<unsigned long>(frame_count),
              static_cast<unsigned long>(elapsed),
              static_cast<unsigned long>(fps));
}

TEST_F(DisplayTest, PerfTestFullScreen) {
  PW_LOG_INFO("=== Test: PerfTestFullScreen ===");

  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());
  ASSERT_TRUE(driver.CreateLvglDisplay().ok());

  lv_obj_t* screen = lv_screen_active();

  PW_LOG_INFO("Running full-screen update test for 2 seconds...");

  uint32_t start_time = hal_timer_millis(nullptr);
  uint32_t frame_count = 0;
  uint8_t hue = 0;

  while (hal_timer_millis(nullptr) - start_time < 2000) {
    // Change entire screen color each frame
    lv_obj_set_style_bg_color(screen, lv_color_hsv_to_rgb(hue, 100, 100), LV_PART_MAIN);
    hue += 5;

    uint32_t wait_ms = lv_timer_handler();
    if (wait_ms > 0) {
      HAL_Delay_Milliseconds(wait_ms);
    }
    frame_count++;
  }

  uint32_t elapsed = hal_timer_millis(nullptr) - start_time;
  uint32_t fps = (frame_count * 1000) / elapsed;

  PW_LOG_INFO("Full-screen: %lu frames in %lu ms = %lu FPS",
              static_cast<unsigned long>(frame_count),
              static_cast<unsigned long>(elapsed),
              static_cast<unsigned long>(fps));
}

}  // namespace
