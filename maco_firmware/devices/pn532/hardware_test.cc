// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// On-device hardware test for PN532 NFC controller.
// Self-contained test that creates hardware instances directly.
//
// Test categories:
// - Hardware Validation: Basic initialization, firmware version
// - RF Operations: Tag detection, APDU exchange
// - Error Handling: No-card detection, recovery

// Pigweed headers first (avoid macro pollution from HAL)
#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"
#include "pb_digital_io/digital_io.h"
#include "pb_stream/uart_stream.h"
#include "pw_async2/dispatcher_for_test.h"
#include "pw_log/log.h"
#include "pw_thread/sleep.h"
#include "pw_unit_test/framework.h"

// HAL headers after Pigweed
#include "delay_hal.h"
#include "gpio_hal.h"
#include "pinmap_hal.h"
#include "timer_hal.h"
#include "usart_hal.h"

namespace {
using namespace std::chrono_literals;

// Pin definitions for PN532 NFC controller
// S1 (MISO/D16) is shared with LED SPI - ensure SPI1 is not in use
constexpr hal_pin_t kPinNfcReset = S1;

// UART baud rate for PN532 HSU mode
constexpr uint32_t kUartBaudRate = 115200;

// Timeout for RF operations (tag might not be present)
constexpr auto kRfOperationTimeout = std::chrono::milliseconds(500);

// Short timeout for expected failures (no card tests)
constexpr auto kShortTimeout = std::chrono::milliseconds(100);

// Long timeout for interactive tests - PN532 will poll RF field continuously
constexpr auto kInteractiveTimeout = std::chrono::seconds(30);

/// Testable subclass that exposes protected methods for hardware testing.
class TestablePn532Reader : public maco::nfc::Pn532NfcReader {
 public:
  using Pn532NfcReader::Pn532NfcReader;  // Inherit constructors

  // Expose protected methods for testing
  using Pn532NfcReader::DoInit;
  using Pn532NfcReader::DoReset;
  using Pn532NfcReader::DoDetectTag;
  using Pn532NfcReader::DoTransceive;
  using Pn532NfcReader::DoCheckTagPresent;
  using Pn532NfcReader::RecoverFromDesync;
};

// Get singleton hardware instances
TestablePn532Reader& GetDriver() {
  static bool initialized = false;
  static pb::ParticleUartStream uart(HAL_USART_SERIAL1);
  static pb::ParticleDigitalOut reset_pin(kPinNfcReset);

  // Initialize peripherals once (minimal - driver.DoInit() does the rest)
  if (!initialized) {
    (void)uart.Init(kUartBaudRate);
    (void)reset_pin.Enable();
    initialized = true;
  }

  static TestablePn532Reader driver(uart, reset_pin);
  return driver;
}

class Pn532HardwareTest : public ::testing::Test {
 protected:
  void SetUp() override { PW_LOG_INFO("=== Pn532HardwareTest::SetUp ==="); }

  void TearDown() override {
    PW_LOG_INFO("=== Pn532HardwareTest::TearDown ===");
    // Reset driver state for next test
    auto& driver = GetDriver();
    if (driver.IsBusy()) {
      PW_LOG_WARN("Driver still busy, attempting recovery...");
      (void)driver.RecoverFromDesync();
    }
  }

  /// Poll a future until ready or max iterations reached (iterations * 10ms).
  /// Uses short-timeout futures to work around RunInTaskUntilStalled spinning
  /// forever on futures that don't set wakers.
  template <typename Future>
  auto PollUntilReady(
      pw::async2::DispatcherForTest& dispatcher,
      Future& future,
      int max_iterations = 200
  ) {
    for (int i = 0; i < max_iterations; ++i) {
      auto poll = dispatcher.RunInTaskUntilStalled(future);
      if (poll.IsReady()) {
        return poll;
      }
      HAL_Delay_Milliseconds(10);
    }
    // Return the last poll result (will be Pending)
    return dispatcher.RunInTaskUntilStalled(future);
  }
};

// ============================================================================
// Raw HAL test - bypass ParticleUartStream entirely
// ============================================================================

TEST_F(Pn532HardwareTest, DISABLED_ParticleUartStreamTest) {
  // Use ParticleUartStream with same sequence as raw HAL test
  pb::ParticleUartStream uart(HAL_USART_SERIAL1);
  ASSERT_TRUE(uart.Init(115200).ok());

  // Init reset pin
  hal_gpio_mode(kPinNfcReset, OUTPUT);

  // Reset sequence
  hal_gpio_write(kPinNfcReset, 0);  // LOW
  HAL_Delay_Milliseconds(20);
  hal_gpio_write(kPinNfcReset, 1);  // HIGH
  HAL_Delay_Milliseconds(10);

  // Wakeup
  std::array<std::byte, 1> wakeup = {std::byte{0x55}};
  ASSERT_TRUE(uart.Write(wakeup).ok());
  HAL_Delay_Milliseconds(2);

  // Send SAMConfiguration
  std::array<std::byte, 12> cmd = {
      std::byte{0x00},
      std::byte{0x00},
      std::byte{0xFF},
      std::byte{0x05},
      std::byte{0xFB},
      std::byte{0xD4},
      std::byte{0x14},
      std::byte{0x01},
      std::byte{0x14},
      std::byte{0x01},
      std::byte{0x02},
      std::byte{0x00}
  };
  ASSERT_TRUE(uart.Write(cmd).ok());

  // Wait for response
  HAL_Delay_Milliseconds(50);

  // Read response
  std::array<std::byte, 32> response{};
  auto result = uart.Read(response);

  size_t count = result.ok() ? result.value().size() : 0;
  PW_LOG_INFO("ParticleUartStream: read %d bytes", static_cast<int>(count));

  if (count > 0) {
    PW_LOG_INFO(
        "ParticleUartStream: first bytes: %02x %02x %02x %02x %02x %02x",
        static_cast<int>(response[0]),
        static_cast<int>(response[1]),
        static_cast<int>(response[2]),
        static_cast<int>(response[3]),
        static_cast<int>(response[4]),
        static_cast<int>(response[5])
    );
  }

  uart.Deinit();
  EXPECT_GT(count, 0u) << "Should have received ACK + response";
}

TEST_F(Pn532HardwareTest, DISABLED_RawHalUartTest) {
  // Use HAL directly, no ParticleUartStream
  hal_usart_interface_t serial = HAL_USART_SERIAL1;

  // Init buffers
  static uint8_t rx_buf[64] = {};
  static uint8_t tx_buf[64] = {};
  hal_usart_buffer_config_t config = {
      .size = sizeof(hal_usart_buffer_config_t),
      .rx_buffer = rx_buf,
      .rx_buffer_size = sizeof(rx_buf),
      .tx_buffer = tx_buf,
      .tx_buffer_size = sizeof(tx_buf),
  };
  hal_usart_init_ex(serial, &config, nullptr);
  hal_usart_begin_config(serial, 115200, SERIAL_8N1, nullptr);

  // Init reset pin
  hal_gpio_mode(kPinNfcReset, OUTPUT);

  // Reset sequence
  hal_gpio_write(kPinNfcReset, 0);  // LOW
  HAL_Delay_Milliseconds(20);
  hal_gpio_write(kPinNfcReset, 1);  // HIGH
  HAL_Delay_Milliseconds(10);

  // Wakeup
  hal_usart_write(serial, 0x55);
  hal_usart_flush(serial);
  HAL_Delay_Milliseconds(2);

  // Send SAMConfiguration: 00 00 FF 05 FB D4 14 01 14 01 02 00
  const uint8_t cmd[] = {
      0x00, 0x00, 0xFF, 0x05, 0xFB, 0xD4, 0x14, 0x01, 0x14, 0x01, 0x02, 0x00
  };
  for (auto b : cmd) {
    hal_usart_write(serial, b);
  }
  hal_usart_flush(serial);

  // Wait for response
  HAL_Delay_Milliseconds(50);

  // Check what's available
  int32_t avail = hal_usart_available(serial);
  PW_LOG_INFO("Raw HAL: available = %d", static_cast<int>(avail));

  // Read whatever is there
  uint8_t response[32] = {};
  int count = 0;
  while (hal_usart_available(serial) > 0 && count < 32) {
    int32_t b = hal_usart_read(serial);
    if (b >= 0) {
      response[count++] = static_cast<uint8_t>(b);
    }
  }

  PW_LOG_INFO("Raw HAL: read %d bytes", count);
  if (count > 0) {
    PW_LOG_INFO(
        "Raw HAL: first bytes: %02x %02x %02x %02x %02x %02x",
        response[0],
        response[1],
        response[2],
        response[3],
        response[4],
        response[5]
    );
  }

  // Clean up
  hal_usart_end(serial);

  EXPECT_GT(count, 0) << "Should have received ACK + response from PN532";
}

// ============================================================================
// Hardware Validation Tests (no card required)
// ============================================================================

TEST_F(Pn532HardwareTest, Init_Succeeds) {
  auto& driver = GetDriver();

  PW_LOG_INFO("Calling driver.DoInit()");
  auto status = driver.DoInit();

  if (!status.ok()) {
    PW_LOG_ERROR(
        "Init failed with status: %d", static_cast<int>(status.code())
    );
  }

  ASSERT_TRUE(status.ok());
  PW_LOG_INFO("Init succeeded");
}

TEST_F(Pn532HardwareTest, Init_ReportsVersion) {
  auto& driver = GetDriver();

  // Init prints firmware version via PW_LOG_INFO
  auto status = driver.DoInit();
  ASSERT_TRUE(status.ok()) << "Init failed";

  // Success - firmware version was logged during Init
  // Expected: IC=0x32, Ver=1.6, Rev=7
  PW_LOG_INFO("Check serial output for firmware version");
}

TEST_F(Pn532HardwareTest, Reset_Succeeds) {
  auto& driver = GetDriver();

  PW_LOG_INFO("Calling driver.DoReset()");
  auto status = driver.DoReset();

  ASSERT_TRUE(status.ok()) << "Reset failed with status: "
                           << static_cast<int>(status.code());
  PW_LOG_INFO("Reset succeeded");
}

TEST_F(Pn532HardwareTest, IsBusy_InitiallyFalse) {
  auto& driver = GetDriver();

  // Init first
  ASSERT_TRUE(driver.DoInit().ok());

  EXPECT_FALSE(driver.IsBusy());
  PW_LOG_INFO("IsBusy() returns false when idle");
}

// ============================================================================
// RF Operations Tests (card may or may not be present)
// ============================================================================

TEST_F(Pn532HardwareTest, DetectTag_NoCard_ReturnsNotFound) {
  auto& driver = GetDriver();
  pw::async2::DispatcherForTest dispatcher;

  ASSERT_TRUE(driver.DoInit().ok());

  PW_LOG_INFO("Testing DetectTag with NO card present...");
  PW_LOG_INFO("(Make sure no card is on the reader!)");

  // Wait a moment for user to remove card if present
  HAL_Delay_Milliseconds(500);

  auto future = driver.DoDetectTag(kShortTimeout);

  // Should be busy now
  EXPECT_TRUE(driver.IsBusy());

  auto poll = PollUntilReady(dispatcher, future);
  ASSERT_TRUE(poll.IsReady()) << "Future did not complete within timeout";

  auto result = poll.value();
  EXPECT_TRUE(result.status().IsNotFound())
      << "Expected NotFound, got: " << static_cast<int>(result.status().code());
  PW_LOG_INFO("DetectTag correctly returned NotFound when no card present");
}

TEST_F(Pn532HardwareTest, DetectTag_WithCard_ReturnsTagInfo) {
  auto& driver = GetDriver();
  pw::async2::DispatcherForTest dispatcher;

  ASSERT_TRUE(driver.DoInit().ok());

  PW_LOG_INFO("=================================================");
  PW_LOG_INFO("PLACE A CARD ON THE READER NOW!");
  PW_LOG_INFO("Waiting 5 seconds for card...");
  PW_LOG_INFO("=================================================");

  // Give user time to place card
  HAL_Delay_Milliseconds(5000);

  auto future = driver.DoDetectTag(kRfOperationTimeout);
  auto poll = PollUntilReady(dispatcher, future);
  ASSERT_TRUE(poll.IsReady()) << "Future did not complete";

  auto result = poll.value();
  if (!result.ok()) {
    PW_LOG_WARN(
        "No card detected (status=%d). Place a card and re-run test.",
        static_cast<int>(result.status().code())
    );
    GTEST_SKIP() << "No card present - skipping card-dependent test";
  }

  const maco::nfc::TagInfo& info = result.value();

  PW_LOG_INFO("Card detected!");
  PW_LOG_INFO("  Target number: %d", info.target_number);
  PW_LOG_INFO("  SAK: 0x%02x", info.sak);
  PW_LOG_INFO("  ISO14443-4: %s", info.supports_iso14443_4 ? "yes" : "no");
  PW_LOG_INFO("  UID length: %u", static_cast<unsigned>(info.uid_length));

  // Log UID bytes
  char uid_str[32] = {0};
  for (size_t i = 0; i < info.uid_length && i < 7; i++) {
    snprintf(uid_str + i * 3, 4, "%02X ", static_cast<unsigned>(info.uid[i]));
  }
  PW_LOG_INFO("  UID: %s", uid_str);

  EXPECT_GT(info.target_number, 0u);
  EXPECT_GT(info.uid_length, 0u);
}

TEST_F(Pn532HardwareTest, CheckTagPresent_WithCard) {
  auto& driver = GetDriver();
  pw::async2::DispatcherForTest dispatcher;

  ASSERT_TRUE(driver.DoInit().ok());

  PW_LOG_INFO("First detecting a card...");

  // Scope the detect future so it's destroyed before creating check future
  {
    auto detect_future = driver.DoDetectTag(kRfOperationTimeout);
    auto detect_poll = PollUntilReady(dispatcher, detect_future);
    ASSERT_TRUE(detect_poll.IsReady()) << "DetectTag did not complete";

    if (!detect_poll.value().ok()) {
      PW_LOG_WARN("No card detected. Place a card and re-run test.");
      GTEST_SKIP() << "No card present";
    }
  }

  PW_LOG_INFO("Card detected, now checking presence...");

  auto check_future = driver.DoCheckTagPresent(kRfOperationTimeout);
  auto check_poll = PollUntilReady(dispatcher, check_future);
  ASSERT_TRUE(check_poll.IsReady()) << "CheckTagPresent did not complete";

  auto result = check_poll.value();
  ASSERT_TRUE(result.ok()) << "CheckTagPresent failed";

  bool present = result.value();
  PW_LOG_INFO("Tag present: %s", present ? "yes" : "no");

  EXPECT_TRUE(present) << "Card should still be present";
}

TEST_F(Pn532HardwareTest, Transceive_SelectNdef_WithCard) {
  auto& driver = GetDriver();
  pw::async2::DispatcherForTest dispatcher;

  ASSERT_TRUE(driver.DoInit().ok());

  PW_LOG_INFO("Detecting card for APDU test...");

  // Scope the detect future so it's destroyed before creating transceive future
  bool supports_iso14443_4 = false;
  {
    auto detect_future = driver.DoDetectTag(kRfOperationTimeout);
    auto detect_poll = PollUntilReady(dispatcher, detect_future);
    ASSERT_TRUE(detect_poll.IsReady()) << "DetectTag did not complete";

    if (!detect_poll.value().ok()) {
      PW_LOG_WARN("No card detected. Place a card and re-run test.");
      GTEST_SKIP() << "No card present";
    }

    supports_iso14443_4 = detect_poll.value().value().supports_iso14443_4;
  }

  if (!supports_iso14443_4) {
    PW_LOG_WARN("Card does not support ISO14443-4 (APDU). Skipping.");
    GTEST_SKIP() << "Card does not support APDU";
  }

  PW_LOG_INFO("Sending SELECT NDEF Application APDU...");

  // SELECT NDEF Application AID (D2760000850101)
  constexpr std::array<std::byte, 13> kSelectNdefApp = {
      std::byte{0x00},  // CLA
      std::byte{0xA4},  // INS: SELECT
      std::byte{0x04},  // P1: Select by DF name
      std::byte{0x00},  // P2
      std::byte{0x07},  // Lc: AID length
      std::byte{0xD2},
      std::byte{0x76},
      std::byte{0x00},
      std::byte{0x00},
      std::byte{0x85},
      std::byte{0x01},
      std::byte{0x01},  // NDEF AID
      std::byte{0x00},  // Le
  };

  std::array<std::byte, 64> response_buffer{};

  auto transceive_future =
      driver.DoTransceive(kSelectNdefApp, response_buffer, kRfOperationTimeout);
  auto transceive_poll = PollUntilReady(dispatcher, transceive_future);
  ASSERT_TRUE(transceive_poll.IsReady()) << "Transceive did not complete";

  auto result = transceive_poll.value();
  if (!result.ok()) {
    PW_LOG_WARN(
        "Transceive failed (status=%d) - card may not support NDEF",
        static_cast<int>(result.status().code())
    );
    // Don't fail test - card might not have NDEF app
    return;
  }

  size_t response_len = result.value();
  PW_LOG_INFO("Response length: %u bytes", static_cast<unsigned>(response_len));

  if (response_len >= 2) {
    uint8_t sw1 = static_cast<uint8_t>(response_buffer[response_len - 2]);
    uint8_t sw2 = static_cast<uint8_t>(response_buffer[response_len - 1]);
    PW_LOG_INFO("Status Word: %02X %02X", sw1, sw2);

    if (sw1 == 0x90 && sw2 == 0x00) {
      PW_LOG_INFO("SELECT NDEF succeeded!");
    } else if (sw1 == 0x6A && sw2 == 0x82) {
      PW_LOG_INFO("File not found - card may not have NDEF app");
    }
  }
}

// ============================================================================
// Error Handling Tests
// ============================================================================

TEST_F(Pn532HardwareTest, RecoverFromDesync_Succeeds) {
  auto& driver = GetDriver();

  ASSERT_TRUE(driver.DoInit().ok());

  PW_LOG_INFO("Testing RecoverFromDesync...");
  auto status = driver.RecoverFromDesync();

  EXPECT_TRUE(status.ok()) << "RecoverFromDesync failed";
  PW_LOG_INFO("RecoverFromDesync completed");
}

TEST_F(Pn532HardwareTest, MultipleInitCalls_Succeed) {
  auto& driver = GetDriver();

  PW_LOG_INFO("Testing multiple Init calls...");

  for (int i = 0; i < 3; i++) {
    PW_LOG_INFO("Init call %d", i + 1);
    auto status = driver.DoInit();
    ASSERT_TRUE(status.ok()) << "Init call " << i + 1 << " failed";
  }

  PW_LOG_INFO("Multiple Init calls succeeded");
}

// ============================================================================
// Interactive Test (manual card placement)
// ============================================================================

TEST_F(Pn532HardwareTest, Interactive_CardDetectionCycles) {
  auto& driver = GetDriver();
  pw::async2::DispatcherForTest dispatcher;

  ASSERT_TRUE(driver.DoInit().ok());

  PW_LOG_INFO("=================================================");
  PW_LOG_INFO("INTERACTIVE TEST: 3x Card Detection Cycles");
  PW_LOG_INFO("You will place and remove the card 3 times.");
  PW_LOG_INFO("=================================================");

  for (int cycle = 1; cycle <= 3; ++cycle) {
    PW_LOG_INFO("---");
    PW_LOG_INFO(
        ">>> Cycle %d/3: PLACE card on reader (30s timeout) <<<", cycle
    );

    // Poll with short timeouts to work around RunInTaskUntilStalled behavior.
    // Each DoDetectTag creates a fresh InListPassiveTarget command.
    bool detected = false;
    maco::nfc::TagInfo tag_info{};
    for (int attempt = 0; attempt < 60 && !detected; ++attempt) {
      auto future = driver.DoDetectTag(kRfOperationTimeout);  // 500ms
      auto poll = PollUntilReady(dispatcher, future);
      if (poll.IsReady() && poll.value().ok()) {
        detected = true;
        tag_info = poll.value().value();
      } else if (attempt % 10 == 0) {
        PW_LOG_INFO("  Waiting... attempt %d/60", attempt);
      }
    }

    ASSERT_TRUE(detected) << "Card not detected within 30s in cycle " << cycle;

    char uid_str[32] = {0};
    for (size_t i = 0; i < tag_info.uid_length && i < 7; i++) {
      snprintf(
          uid_str + i * 3, 4, "%02X ", static_cast<unsigned>(tag_info.uid[i])
      );
    }
    PW_LOG_INFO(
        "  DETECTED! UID: %s SAK: 0x%02X ISO14443-4: %s",
        uid_str,
        tag_info.sak,
        tag_info.supports_iso14443_4 ? "yes" : "no"
    );

    PW_LOG_INFO(
        ">>> Cycle %d/3: REMOVE card from reader (30s timeout) <<<", cycle
    );

    // Wait for card removal using CheckTagPresent (not DetectTag)
    // CheckTagPresent sends a command to the existing target to verify it's
    // still there Throttle to ~5Hz to avoid spamming the PN532
    bool removed = false;
    for (int attempt = 0; attempt < 150 && !removed;
         ++attempt) {  // 150 * 200ms = 30s
      auto future = driver.DoCheckTagPresent(kShortTimeout);  // 100ms timeout
      auto poll = PollUntilReady(dispatcher, future);
      if (poll.IsReady()) {
        if (!poll.value().ok()) {
          // Error (likely card removed mid-transaction) - recover and treat as
          // removed
          PW_LOG_INFO("  Error during presence check, recovering...");
          (void)driver.RecoverFromDesync();
          removed = true;
          PW_LOG_INFO("  REMOVED!");
        } else if (!poll.value().value()) {
          // Tag explicitly not present
          removed = true;
          PW_LOG_INFO("  REMOVED!");
        }
      }
      if (!removed) {
        HAL_Delay_Milliseconds(200);  // ~5Hz polling rate
      }
    }
    ASSERT_TRUE(removed) << "Card not removed within 30s in cycle " << cycle;
  }

  PW_LOG_INFO("---");
  PW_LOG_INFO("=================================================");
  PW_LOG_INFO("SUCCESS! All 3 cycles completed.");
  PW_LOG_INFO("=================================================");
}

}  // namespace
