// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Hardware test to verify SPI MOSI_ONLY mode allows GPIO use of MISO/SCK pins.
//
// Test setup:
// - SPI0 configured with MOSI_ONLY flag for LED strip (MOSI on S0/D15)
// - D16 (S1/MISO) and D17 (S2/SCK) configured as GPIO outputs
//
// Expected behavior:
// - LEDs update at ~30fps via SPI
// - D16 and D17 toggle at 2Hz as clean square waves
// - Oscilloscope should show no SPI interference on D16/D17
//
// Success criteria: D16/D17 show clean 2Hz square waves, LEDs animate smoothly.

#include "delay_hal.h"
#include "gpio_hal.h"
#include "maco_firmware/devices/in4818/in4818_led_driver.h"
#include "pb_digital_io/digital_io.h"
#include "pb_spi/initiator.h"
#include "pinmap_hal.h"
#include "pw_log/log.h"
#include "pw_unit_test/framework.h"
#include "timer_hal.h"

namespace {

constexpr uint16_t kNumLeds = 16;

class SpiMosiOnlyTest : public ::testing::Test {
 protected:
  void SetUp() override { PW_LOG_INFO("=== SpiMosiOnlyTest::SetUp ==="); }

  void TearDown() override { PW_LOG_INFO("=== SpiMosiOnlyTest::TearDown ==="); }

  void DelayMs(uint32_t ms) { HAL_Delay_Milliseconds(ms); }
};

TEST_F(SpiMosiOnlyTest, GpioUnaffectedBySpi) {
  PW_LOG_INFO("=== SPI MOSI_ONLY GPIO Test ===");
  PW_LOG_INFO("Testing that D16 (MISO) and D17 (SCK) work as GPIO");
  PW_LOG_INFO("while SPI is active on MOSI for LED updates.");
  PW_LOG_INFO(" ");
  PW_LOG_INFO("Connect oscilloscope to D16 and D17.");
  PW_LOG_INFO("Expected: Clean 2Hz square waves on both pins.");
  PW_LOG_INFO(" ");

  // Configure SPI with MOSI_ONLY flag - only claims MOSI pin
  static pb::ParticleSpiInitiator spi_initiator(
      pb::ParticleSpiInitiator::Interface::kSpi,
      maco::led::In4818LedDriver<kNumLeds>::kSpiClockHz,
      pb::SpiFlags::kMosiOnly);

  static maco::led::In4818LedDriver<kNumLeds> led_driver(spi_initiator);
  ASSERT_TRUE(led_driver.Init().ok()) << "LED driver init failed";

  // Configure D16 (S1/MISO) and D17 (S2/SCK) as GPIO outputs
  static pb::ParticleDigitalOut pin_d16(S1);  // MISO pin
  static pb::ParticleDigitalOut pin_d17(S2);  // SCK pin

  ASSERT_TRUE(pin_d16.Enable().ok()) << "D16 enable failed";
  ASSERT_TRUE(pin_d17.Enable().ok()) << "D17 enable failed";

  // Test parameters
  constexpr uint32_t kTestDurationMs = 30000;       // 30 seconds
  constexpr uint32_t kGpioTogglePeriodMs = 500;     // 2Hz = 500ms period
  constexpr uint32_t kLedUpdatePeriodMs = 33;       // ~30fps
  constexpr uint32_t kStatsIntervalMs = 5000;       // Stats every 5s

  PW_LOG_INFO("Running for %lu seconds...",
              static_cast<unsigned long>(kTestDurationMs / 1000));
  PW_LOG_INFO("LED update rate: ~30fps");
  PW_LOG_INFO("GPIO toggle rate: 2Hz (250ms high, 250ms low)");
  PW_LOG_INFO(" ");

  uint32_t test_start = hal_timer_millis(nullptr);
  uint32_t last_gpio_toggle = test_start;
  uint32_t last_led_update = test_start;
  uint32_t last_stats = test_start;
  uint32_t led_frames = 0;
  uint32_t gpio_toggles = 0;
  bool gpio_state = false;

  // Breathing animation state
  constexpr uint32_t kBreathePeriodMs = 2000;  // 2 second full cycle

  while (true) {
    uint32_t now = hal_timer_millis(nullptr);
    uint32_t elapsed = now - test_start;

    if (elapsed >= kTestDurationMs) {
      break;
    }

    // Toggle GPIO at 2Hz (every 250ms half-period)
    if (now - last_gpio_toggle >= kGpioTogglePeriodMs / 2) {
      gpio_state = !gpio_state;
      auto state =
          gpio_state ? pw::digital_io::State::kActive
                     : pw::digital_io::State::kInactive;
      (void)pin_d16.SetState(state);
      (void)pin_d17.SetState(state);
      last_gpio_toggle = now;
      gpio_toggles++;
    }

    // Update LEDs at ~30fps (every 33ms)
    if (now - last_led_update >= kLedUpdatePeriodMs) {
      // Breathing animation: directly vary white channel value
      uint32_t phase = (elapsed % kBreathePeriodMs) * 512 / kBreathePeriodMs;
      uint8_t white;
      if (phase < 256) {
        white = static_cast<uint8_t>(phase);  // Ramp up
      } else {
        white = static_cast<uint8_t>(511 - phase);  // Ramp down
      }

      // Set all pixels to white at calculated intensity
      led_driver.Fill({0, 0, 0, white});
      auto status = led_driver.Show();
      if (!status.ok()) {
        PW_LOG_ERROR("LED Show() failed at frame %lu",
                     static_cast<unsigned long>(led_frames));
        FAIL();
      }

      last_led_update = now;
      led_frames++;
    }

    // Print stats every 5 seconds
    if (now - last_stats >= kStatsIntervalMs) {
      uint32_t elapsed_sec = elapsed / 1000;
      PW_LOG_INFO("[%2lu s] LED frames: %lu, GPIO toggles: %lu",
                  static_cast<unsigned long>(elapsed_sec),
                  static_cast<unsigned long>(led_frames),
                  static_cast<unsigned long>(gpio_toggles));
      last_stats = now;
    }
  }

  // Final stats
  uint32_t total_elapsed = hal_timer_millis(nullptr) - test_start;
  uint32_t avg_led_fps = led_frames * 1000 / total_elapsed;
  float gpio_freq = static_cast<float>(gpio_toggles) / 2.0f /
                    (static_cast<float>(total_elapsed) / 1000.0f);

  PW_LOG_INFO(" ");
  PW_LOG_INFO("=== TEST COMPLETE ===");
  PW_LOG_INFO("Duration: %lu ms", static_cast<unsigned long>(total_elapsed));
  PW_LOG_INFO("LED frames: %lu (~%lu fps)",
              static_cast<unsigned long>(led_frames),
              static_cast<unsigned long>(avg_led_fps));
  PW_LOG_INFO("GPIO toggles: %lu (~%.1f Hz)",
              static_cast<unsigned long>(gpio_toggles),
              static_cast<double>(gpio_freq));
  PW_LOG_INFO(" ");
  PW_LOG_INFO("Verify with oscilloscope:");
  PW_LOG_INFO("- D16 and D17 should show clean 2Hz square waves");
  PW_LOG_INFO("- No glitches or SPI interference should be visible");

  // Clear LEDs at end
  led_driver.Clear();
  (void)led_driver.Show();

  // Leave GPIOs low
  (void)pin_d16.SetState(pw::digital_io::State::kInactive);
  (void)pin_d17.SetState(pw::digital_io::State::kInactive);
}

}  // namespace
