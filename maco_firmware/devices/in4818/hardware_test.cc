// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// On-device test for IN4818 RGBW LED driver.
// Self-contained test that creates hardware instances directly.

#include "delay_hal.h"
#include "maco_firmware/devices/in4818/in4818_led_driver.h"
#include "pb_spi/initiator.h"
#include "pinmap_hal.h"
#include "pw_log/log.h"
#include "pw_unit_test/framework.h"
#include "timer_hal.h"

namespace {

// Number of LEDs in the strip
constexpr uint16_t kNumLeds = 16;

// Create hardware instance (singleton pattern for test lifetime)
maco::led::In4818LedDriver<kNumLeds>& GetDriver() {
  // SPI interface 0 for LED strip
  static pb::ParticleSpiInitiator spi_initiator(
      pb::ParticleSpiInitiator::Interface::kSpi,
      maco::led::In4818LedDriver<kNumLeds>::kSpiClockHz);

  static maco::led::In4818LedDriver<kNumLeds> driver(spi_initiator);
  return driver;
}

class LedTest : public ::testing::Test {
 protected:
  void SetUp() override {
    PW_LOG_INFO("=== LedTest::SetUp ===");
  }

  void TearDown() override {
    // Clear LEDs after each test
    auto& driver = GetDriver();
    driver.Clear();
    (void)driver.Show();
  }

  // Delay helper for visual inspection
  void DelayMs(uint32_t ms) { HAL_Delay_Milliseconds(ms); }
};

TEST_F(LedTest, DriverInitSucceeds) {
  auto& driver = GetDriver();

  PW_LOG_INFO("Calling driver.Init()");
  auto status = driver.Init();
  ASSERT_TRUE(status.ok()) << "Driver Init failed";
  PW_LOG_INFO("driver.Init() succeeded");
}

TEST_F(LedTest, ClearAllLeds) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());

  PW_LOG_INFO("Clearing all LEDs...");
  driver.Clear();
  auto status = driver.Show();
  ASSERT_TRUE(status.ok()) << "Show() failed";
  PW_LOG_INFO("All LEDs cleared");

  // Verify all pixels are black
  for (uint16_t i = 0; i < kNumLeds; ++i) {
    auto color = driver.GetPixel(i);
    EXPECT_EQ(color.r, 0);
    EXPECT_EQ(color.g, 0);
    EXPECT_EQ(color.b, 0);
    EXPECT_EQ(color.w, 0);
  }
}

TEST_F(LedTest, SetIndividualPixels) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());

  PW_LOG_INFO("Testing individual pixel colors...");

  // Set first LED to red
  driver.SetPixel(0, maco::led::RgbwColor::Red());
  ASSERT_TRUE(driver.Show().ok());
  DelayMs(500);

  // Set second LED to green
  driver.SetPixel(1, maco::led::RgbwColor::Green());
  ASSERT_TRUE(driver.Show().ok());
  DelayMs(500);

  // Set third LED to blue
  driver.SetPixel(2, maco::led::RgbwColor::Blue());
  ASSERT_TRUE(driver.Show().ok());
  DelayMs(500);

  // Set fourth LED to white (using W channel)
  driver.SetPixel(3, maco::led::RgbwColor::White());
  ASSERT_TRUE(driver.Show().ok());
  DelayMs(500);

  // Verify pixel values
  auto red = driver.GetPixel(0);
  EXPECT_EQ(red.r, 255);
  EXPECT_EQ(red.g, 0);
  EXPECT_EQ(red.b, 0);
  EXPECT_EQ(red.w, 0);

  auto green = driver.GetPixel(1);
  EXPECT_EQ(green.r, 0);
  EXPECT_EQ(green.g, 255);
  EXPECT_EQ(green.b, 0);
  EXPECT_EQ(green.w, 0);

  auto blue = driver.GetPixel(2);
  EXPECT_EQ(blue.r, 0);
  EXPECT_EQ(blue.g, 0);
  EXPECT_EQ(blue.b, 255);
  EXPECT_EQ(blue.w, 0);

  auto white = driver.GetPixel(3);
  EXPECT_EQ(white.r, 0);
  EXPECT_EQ(white.g, 0);
  EXPECT_EQ(white.b, 0);
  EXPECT_EQ(white.w, 255);

  PW_LOG_INFO("Individual pixel test complete (R, G, B, W visible)");
}

TEST_F(LedTest, FillAllPixels) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());

  const maco::led::RgbwColor colors[] = {
      maco::led::RgbwColor::Red(),
      maco::led::RgbwColor::Green(),
      maco::led::RgbwColor::Blue(),
      maco::led::RgbwColor::White(),
      maco::led::RgbwColor::Yellow(),
      maco::led::RgbwColor::Cyan(),
      maco::led::RgbwColor::Magenta(),
  };
  constexpr size_t kNumColors = sizeof(colors) / sizeof(colors[0]);

  PW_LOG_INFO("Filling all LEDs with solid colors...");
  PW_LOG_INFO("Colors: Red, Green, Blue, White, Yellow, Cyan, Magenta");

  for (size_t i = 0; i < kNumColors; ++i) {
    driver.Fill(colors[i]);
    ASSERT_TRUE(driver.Show().ok());
    DelayMs(500);
  }

  PW_LOG_INFO("Fill test complete");
}

TEST_F(LedTest, BrightnessControl) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());

  PW_LOG_INFO("Testing brightness control...");

  // Fill with white
  driver.Fill(maco::led::RgbwColor::White());

  // Fade from full brightness to off
  PW_LOG_INFO("Fading from 255 to 0...");
  for (int brightness = 255; brightness >= 0; brightness -= 5) {
    driver.SetBrightness(static_cast<uint8_t>(brightness));
    ASSERT_TRUE(driver.Show().ok());
    DelayMs(20);
  }

  // Fade from off to full brightness
  PW_LOG_INFO("Fading from 0 to 255...");
  for (int brightness = 0; brightness <= 255; brightness += 5) {
    driver.SetBrightness(static_cast<uint8_t>(brightness));
    ASSERT_TRUE(driver.Show().ok());
    DelayMs(20);
  }

  // Reset brightness
  driver.SetBrightness(255);
  EXPECT_EQ(driver.brightness(), 255);

  PW_LOG_INFO("Brightness test complete");
}

TEST_F(LedTest, RainbowCycle) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());

  PW_LOG_INFO("Running rainbow cycle animation (5 seconds)...");

  constexpr uint32_t kTestDurationMs = 5000;
  uint32_t start_time = hal_timer_millis(nullptr);
  uint8_t hue_offset = 0;

  while (hal_timer_millis(nullptr) - start_time < kTestDurationMs) {
    // Set each LED to a different hue
    for (uint16_t i = 0; i < kNumLeds; ++i) {
      uint8_t hue = hue_offset + (i * 256 / kNumLeds);

      // Simple HSV to RGB conversion (S=255, V=255)
      uint8_t region = hue / 43;
      uint8_t remainder = (hue - region * 43) * 6;

      uint8_t r, g, b;
      switch (region) {
        case 0:
          r = 255;
          g = remainder;
          b = 0;
          break;
        case 1:
          r = 255 - remainder;
          g = 255;
          b = 0;
          break;
        case 2:
          r = 0;
          g = 255;
          b = remainder;
          break;
        case 3:
          r = 0;
          g = 255 - remainder;
          b = 255;
          break;
        case 4:
          r = remainder;
          g = 0;
          b = 255;
          break;
        default:
          r = 255;
          g = 0;
          b = 255 - remainder;
          break;
      }

      driver.SetPixel(i, {r, g, b, 0});
    }

    ASSERT_TRUE(driver.Show().ok());
    hue_offset += 2;
    DelayMs(20);
  }

  PW_LOG_INFO("Rainbow cycle complete");
}

TEST_F(LedTest, ChaseAnimation) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());

  PW_LOG_INFO("Running chase animation (3 cycles)...");

  constexpr uint32_t kCycles = 3;
  const maco::led::RgbwColor chase_color = maco::led::RgbwColor::Blue();

  for (uint32_t cycle = 0; cycle < kCycles; ++cycle) {
    for (uint16_t pos = 0; pos < kNumLeds; ++pos) {
      driver.Clear();
      driver.SetPixel(pos, chase_color);
      // Add a dimmer tail
      if (pos > 0) {
        driver.SetPixel(pos - 1, {0, 0, 64, 0});
      }
      if (pos > 1) {
        driver.SetPixel(pos - 2, {0, 0, 16, 0});
      }
      ASSERT_TRUE(driver.Show().ok());
      DelayMs(50);
    }
  }

  PW_LOG_INFO("Chase animation complete");
}

TEST_F(LedTest, PerfTestShowFrameRate) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());

  constexpr uint32_t kFrameCount = 100;

  PW_LOG_INFO("Running performance test for %lu frames...",
              static_cast<unsigned long>(kFrameCount));

  // Pre-fill with a pattern
  for (uint16_t i = 0; i < kNumLeds; ++i) {
    driver.SetPixel(i, {static_cast<uint8_t>(i * 16),
                        static_cast<uint8_t>(255 - i * 16), 128, 0});
  }

  uint32_t total_time = 0;
  uint32_t min_time = UINT32_MAX;
  uint32_t max_time = 0;

  for (uint32_t i = 0; i < kFrameCount; ++i) {
    uint32_t frame_start = hal_timer_millis(nullptr);
    auto status = driver.Show();
    uint32_t frame_time = hal_timer_millis(nullptr) - frame_start;

    ASSERT_TRUE(status.ok());

    total_time += frame_time;
    if (frame_time < min_time) min_time = frame_time;
    if (frame_time > max_time) max_time = frame_time;
  }

  uint32_t avg_time = total_time / kFrameCount;
  uint32_t max_fps = avg_time > 0 ? 1000 / avg_time : 9999;

  PW_LOG_INFO("Performance results for %u LEDs:", kNumLeds);
  PW_LOG_INFO("  Total time: %lu ms for %lu frames",
              static_cast<unsigned long>(total_time),
              static_cast<unsigned long>(kFrameCount));
  PW_LOG_INFO("  Frame time: min=%lu ms, avg=%lu ms, max=%lu ms",
              static_cast<unsigned long>(min_time),
              static_cast<unsigned long>(avg_time),
              static_cast<unsigned long>(max_time));
  PW_LOG_INFO("  Max achievable FPS: %lu", static_cast<unsigned long>(max_fps));

  // Buffer size info
  PW_LOG_INFO("  SPI buffer size: %lu bytes",
              static_cast<unsigned long>(
                  maco::led::In4818LedDriver<kNumLeds>::kBufferSize));
}

TEST_F(LedTest, StressTestContinuousUpdate) {
  auto& driver = GetDriver();
  ASSERT_TRUE(driver.Init().ok());

  // 30 second stress test
  constexpr uint32_t kTestDurationMs = 30 * 1000;
  constexpr uint32_t kStatsIntervalMs = 5000;

  PW_LOG_INFO("=== STRESS TEST: 30 seconds continuous update ===");
  PW_LOG_INFO("Statistics every 5 seconds. Watch for glitches!");

  uint32_t test_start = hal_timer_millis(nullptr);
  uint32_t stats_start = test_start;
  uint32_t total_frames = 0;
  uint32_t interval_frames = 0;
  uint8_t hue = 0;

  while (hal_timer_millis(nullptr) - test_start < kTestDurationMs) {
    // Simple color cycling
    for (uint16_t i = 0; i < kNumLeds; ++i) {
      uint8_t pixel_hue = hue + (i * 256 / kNumLeds);
      // Quick HSV approximation
      driver.SetPixel(i, {static_cast<uint8_t>(pixel_hue),
                          static_cast<uint8_t>(255 - pixel_hue),
                          static_cast<uint8_t>(128), 0});
    }

    auto status = driver.Show();
    if (!status.ok()) {
      PW_LOG_ERROR("Show() failed at frame %lu",
                   static_cast<unsigned long>(total_frames));
      FAIL();
    }

    hue += 1;
    interval_frames++;
    total_frames++;

    // Print stats at intervals
    uint32_t now = hal_timer_millis(nullptr);
    if (now - stats_start >= kStatsIntervalMs) {
      uint32_t elapsed_sec = (now - test_start) / 1000;
      uint32_t fps = interval_frames * 1000 / (now - stats_start);

      PW_LOG_INFO("[%lu s] frames=%lu fps=%lu",
                  static_cast<unsigned long>(elapsed_sec),
                  static_cast<unsigned long>(interval_frames),
                  static_cast<unsigned long>(fps));

      stats_start = now;
      interval_frames = 0;
    }
  }

  uint32_t total_elapsed = hal_timer_millis(nullptr) - test_start;
  uint32_t avg_fps = total_frames * 1000 / total_elapsed;

  PW_LOG_INFO("=== STRESS TEST COMPLETE ===");
  PW_LOG_INFO("Total: %lu frames in %lu ms (%lu FPS avg)",
              static_cast<unsigned long>(total_frames),
              static_cast<unsigned long>(total_elapsed),
              static_cast<unsigned long>(avg_fps));
}

}  // namespace
