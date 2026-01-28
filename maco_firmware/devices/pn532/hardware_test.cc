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
//
// These tests use the actual production coroutines with a BasicDispatcher.
// See RunCoro() helper for the synchronous wrapper pattern.

// Must define PW_LOG_MODULE_NAME before including any headers that use pw_log
#define PW_LOG_MODULE_NAME "pn532"

// Pigweed headers first (avoid macro pollution from HAL)
#include "maco_firmware/devices/pn532/pn532_command.h"
#include "maco_firmware/devices/pn532/pn532_constants.h"
#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"
#include "pb_digital_io/digital_io.h"
#include "pb_uart/async_uart.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_async2/coro.h"
#include "pw_async2/system_time_provider.h"
#include "pw_log/log.h"
#include "pw_unit_test/framework.h"

// HAL headers after Pigweed
#include "delay_hal.h"
#include "pinmap_hal.h"

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
///
/// Uses the actual async coroutines with a dispatcher for testing.
class TestablePn532Reader : public maco::nfc::Pn532NfcReader {
 public:
  using Pn532NfcReader::Pn532NfcReader;  // Inherit constructors

  // Expose protected methods for testing
  using Pn532NfcReader::DoReleaseTag;
  using Pn532NfcReader::ParseCheckPresentResponse;
  using Pn532NfcReader::ParseDetectResponse;
  using Pn532NfcReader::ParseTransceiveResponse;
  using Pn532NfcReader::RecoverFromDesync;

  // Expose the async coroutines
  using Pn532NfcReader::CheckTagPresent;
  using Pn532NfcReader::DetectTag;
  using Pn532NfcReader::DoAsyncInit;
  using Pn532NfcReader::Transceive;
};

// Allocator for the driver (needs space for coroutine frames)
pw::allocator::test::AllocatorForTest<2048> test_allocator;

// UART buffer size for PN532 frames (max normal frame ~262 bytes)
constexpr size_t kUartBufferSize = 265;

// Get singleton hardware instances
TestablePn532Reader& GetDriver() {
  // UART buffers must be 32-byte aligned for DMA on RTL872x
  alignas(32) static std::byte rx_buf[kUartBufferSize];
  alignas(32) static std::byte tx_buf[kUartBufferSize];
  static pb::AsyncUart uart(HAL_USART_SERIAL1, rx_buf, tx_buf);
  static pb::ParticleDigitalOut reset_pin(kPinNfcReset);

  // Initialize peripherals once
  static bool initialized = false;
  if (!initialized) {
    (void)uart.Init(kUartBaudRate);
    (void)reset_pin.Enable();
    initialized = true;
  }

  static TestablePn532Reader driver(uart, reset_pin, test_allocator);
  return driver;
}

// Wrapper task to run a coroutine with arbitrary return type
template <typename T>
class CoroRunnerTask : public pw::async2::Task {
 public:
  explicit CoroRunnerTask(pw::async2::Coro<T>&& coro)
      : coro_(std::move(coro)) {}

  bool is_complete() const { return result_.has_value(); }
  T& result() { return *result_; }

 private:
  pw::async2::Poll<> DoPend(pw::async2::Context& cx) override {
    auto poll = coro_.Pend(cx);
    if (poll.IsPending()) {
      return pw::async2::Pending();
    }
    result_.emplace(std::move(*poll));
    return pw::async2::Ready();
  }

  pw::async2::Coro<T> coro_;
  std::optional<T> result_;
};

// Helper to run a coroutine synchronously using a dispatcher
template <typename T>
T RunCoro(pw::async2::Coro<T> coro) {
  pw::async2::BasicDispatcher dispatcher;
  CoroRunnerTask<T> task(std::move(coro));

  dispatcher.Post(task);

  // Run until the coroutine completes
  while (!task.is_complete()) {
    dispatcher.RunUntilStalled();
    HAL_Delay_Milliseconds(1);
  }

  return std::move(task.result());
}

class Pn532HardwareTest : public ::testing::Test {
 protected:
  void SetUp() override { PW_LOG_INFO("=== Pn532HardwareTest::SetUp ==="); }

  void TearDown() override {
    PW_LOG_INFO("=== Pn532HardwareTest::TearDown ===");
    // Reset driver state for next test
    (void)DoRecoverFromDesync();
  }

  // Helper to run init and return status
  pw::Status DoInit() {
    auto& driver = GetDriver();
    return RunCoro(driver.DoAsyncInit(coro_cx_));
  }

  // Helper to detect tag
  pw::Result<maco::nfc::TagInfo> DetectTag(
      pw::chrono::SystemClock::duration timeout
  ) {
    auto& driver = GetDriver();
    return RunCoro(driver.DetectTag(coro_cx_, timeout));
  }

  // Helper to check tag presence
  pw::Result<bool> CheckTagPresent(pw::chrono::SystemClock::duration timeout) {
    auto& driver = GetDriver();
    return RunCoro(driver.CheckTagPresent(coro_cx_, timeout));
  }

  // Helper to transceive
  pw::Result<size_t> Transceive(
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout
  ) {
    auto& driver = GetDriver();
    return RunCoro(
        driver.Transceive(coro_cx_, command, response_buffer, timeout)
    );
  }

  // Helper to recover from desync
  pw::Status DoRecoverFromDesync() {
    auto& driver = GetDriver();
    return RunCoro(driver.RecoverFromDesync(coro_cx_));
  }

  pw::async2::CoroContext coro_cx_{test_allocator};
};

// ============================================================================
// Hardware Validation Tests (no card required)
// ============================================================================

TEST_F(Pn532HardwareTest, Init_Succeeds) {
  PW_LOG_INFO("Calling DoInit()");
  auto status = DoInit();

  ASSERT_TRUE(status.ok())
      << "Init failed with status: " << static_cast<int>(status.code());
  PW_LOG_INFO("Init succeeded");
}

// ============================================================================
// RF Operations Tests (card may or may not be present)
// ============================================================================

TEST_F(Pn532HardwareTest, DetectTag_NoCard_ReturnsNotFound) {
  ASSERT_TRUE(DoInit().ok());

  PW_LOG_INFO("Testing DetectTag with NO card present...");
  PW_LOG_INFO("(Make sure no card is on the reader!)");

  // Wait a moment for user to remove card if present
  HAL_Delay_Milliseconds(500);

  auto result = DetectTag(kShortTimeout);

  EXPECT_TRUE(result.status().IsNotFound())
      << "Expected NotFound, got: " << static_cast<int>(result.status().code());
  PW_LOG_INFO("DetectTag correctly returned NotFound when no card present");
}

TEST_F(Pn532HardwareTest, DetectTag_WithCard_ReturnsTagInfo) {
  ASSERT_TRUE(DoInit().ok());

  PW_LOG_INFO("=================================================");
  PW_LOG_INFO("PLACE A CARD ON THE READER NOW!");
  PW_LOG_INFO("Waiting 5 seconds for card...");
  PW_LOG_INFO("=================================================");

  // Give user time to place card
  HAL_Delay_Milliseconds(5000);

  auto result = DetectTag(kRfOperationTimeout);

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
  ASSERT_TRUE(DoInit().ok());

  PW_LOG_INFO("First detecting a card...");

  auto detect_result = DetectTag(kRfOperationTimeout);
  if (!detect_result.ok()) {
    PW_LOG_WARN("No card detected. Place a card and re-run test.");
    GTEST_SKIP() << "No card present";
  }

  PW_LOG_INFO("Card detected, now checking presence...");

  auto check_result = CheckTagPresent(kRfOperationTimeout);
  ASSERT_TRUE(check_result.ok()) << "CheckTagPresent failed";

  bool present = check_result.value();
  PW_LOG_INFO("Tag present: %s", present ? "yes" : "no");

  EXPECT_TRUE(present) << "Card should still be present";
}

TEST_F(Pn532HardwareTest, Transceive_SelectNdef_WithCard) {
  ASSERT_TRUE(DoInit().ok());

  PW_LOG_INFO("Detecting card for APDU test...");

  auto detect_result = DetectTag(kRfOperationTimeout);
  if (!detect_result.ok()) {
    PW_LOG_WARN("No card detected. Place a card and re-run test.");
    GTEST_SKIP() << "No card present";
  }

  bool supports_iso14443_4 = detect_result.value().supports_iso14443_4;

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

  auto result =
      Transceive(kSelectNdefApp, response_buffer, kRfOperationTimeout);

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
  ASSERT_TRUE(DoInit().ok());

  PW_LOG_INFO("Testing RecoverFromDesync...");
  auto status = DoRecoverFromDesync();

  EXPECT_TRUE(status.ok()) << "RecoverFromDesync failed";
  PW_LOG_INFO("RecoverFromDesync completed");
}

TEST_F(Pn532HardwareTest, MultipleInitCalls_Succeed) {
  PW_LOG_INFO("Testing multiple Init calls...");

  for (int i = 0; i < 3; i++) {
    PW_LOG_INFO("Init call %d", i + 1);
    auto status = DoInit();
    ASSERT_TRUE(status.ok()) << "Init call " << i + 1 << " failed";
  }

  PW_LOG_INFO("Multiple Init calls succeeded");
}

// ============================================================================
// Interactive Test (manual card placement)
// ============================================================================

TEST_F(Pn532HardwareTest, Interactive_CardDetectionCycles) {
  ASSERT_TRUE(DoInit().ok());

  PW_LOG_INFO("=================================================");
  PW_LOG_INFO("INTERACTIVE TEST: 3x Card Detection Cycles");
  PW_LOG_INFO("You will place and remove the card 3 times.");
  PW_LOG_INFO("=================================================");

  for (int cycle = 1; cycle <= 3; ++cycle) {
    PW_LOG_INFO("---");
    PW_LOG_INFO(
        ">>> Cycle %d/3: PLACE card on reader (30s timeout) <<<", cycle
    );

    // Poll with short timeouts
    bool detected = false;
    maco::nfc::TagInfo tag_info{};
    for (int attempt = 0; attempt < 60 && !detected; ++attempt) {
      auto result = DetectTag(kRfOperationTimeout);
      if (result.ok()) {
        detected = true;
        tag_info = result.value();
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

    // Wait for card removal using CheckTagPresent
    bool removed = false;
    for (int attempt = 0; attempt < 150 && !removed; ++attempt) {
      auto result = CheckTagPresent(kShortTimeout);
      if (!result.ok()) {
        // Error (likely card removed mid-transaction) - recover and treat as
        // removed
        PW_LOG_INFO("  Error during presence check, recovering...");
        (void)DoRecoverFromDesync();
        removed = true;
        PW_LOG_INFO("  REMOVED!");
      } else if (!result.value()) {
        // Tag explicitly not present
        removed = true;
        PW_LOG_INFO("  REMOVED!");
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
