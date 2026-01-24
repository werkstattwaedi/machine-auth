// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Utility to prepare an NTAG424 DNA tag for hardware integration testing.
//
// This utility:
// 1. Authenticates with the default key (all zeros)
// 2. Changes key 0 to the test key
// 3. Optionally configures file settings
//
// Run once on a fresh/factory-reset tag to prepare it for testing.
// After preparation, the tag can be reused for ntag424_hardware_test.
//
// WARNING: This changes the tag's key! To reset, you'll need to authenticate
// with the test key and change it back, or use NXP TagWriter app.

// Pigweed headers first (avoid macro pollution from HAL)
#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag_async.h"
#include "pb_digital_io/digital_io.h"
#include "pb_stream/uart_stream.h"
#include "pw_async2/dispatcher_for_test.h"

#define PW_LOG_MODULE_NAME "prepare"

#include "pw_log/log.h"
#include "pw_unit_test/framework.h"

// HAL headers after Pigweed
#include "delay_hal.h"
#include "gpio_hal.h"
#include "pinmap_hal.h"
#include "rng_hal.h"

namespace {
using namespace std::chrono_literals;

// Pin definitions
constexpr hal_pin_t kPinNfcReset = S1;
constexpr uint32_t kUartBaudRate = 115200;
constexpr auto kRfOperationTimeout = std::chrono::milliseconds(500);

// ============================================================================
// Keys - MUST MATCH ntag424_hardware_test.cc
// ============================================================================

// Default factory key (all zeros)
constexpr std::array<std::byte, 16> kDefaultKey = {};

// Test key that will be set on the tag
constexpr std::array<std::byte, 16> kTestKey = {
    std::byte{0x00}, std::byte{0x11}, std::byte{0x22}, std::byte{0x33},
    std::byte{0x44}, std::byte{0x55}, std::byte{0x66}, std::byte{0x77},
    std::byte{0x88}, std::byte{0x99}, std::byte{0xAA}, std::byte{0xBB},
    std::byte{0xCC}, std::byte{0xDD}, std::byte{0xEE}, std::byte{0xFF},
};

// ============================================================================
// Hardware Access
// ============================================================================

/// Testable subclass that exposes protected methods for hardware testing.
class TestablePn532Reader : public maco::nfc::Pn532NfcReader {
 public:
  using Pn532NfcReader::Pn532NfcReader;  // Inherit constructors
  using Pn532NfcReader::DoDetectTag;     // Expose for testing
  using Pn532NfcReader::DoTransceive;    // Expose for testing
};

class HardwareRng : public pw::random::RandomGenerator {
 public:
  void Get(pw::ByteSpan dest) override {
    auto* ptr = dest.data();
    size_t remaining = dest.size();
    while (remaining >= 4) {
      uint32_t value = HAL_RNG_GetRandomNumber();
      std::memcpy(ptr, &value, 4);
      ptr += 4;
      remaining -= 4;
    }
    if (remaining > 0) {
      uint32_t value = HAL_RNG_GetRandomNumber();
      std::memcpy(ptr, &value, remaining);
    }
  }
  void InjectEntropyBits(uint32_t, uint_fast8_t) override {}
};

TestablePn532Reader& GetReader() {
  static bool initialized = false;
  static pb::ParticleUartStream uart(HAL_USART_SERIAL1);
  static pb::ParticleDigitalOut reset_pin(kPinNfcReset);

  if (!initialized) {
    (void)uart.Init(kUartBaudRate);
    (void)reset_pin.Enable();
    initialized = true;
  }

  static TestablePn532Reader reader(uart, reset_pin);
  return reader;
}

HardwareRng& GetRng() {
  static HardwareRng rng;
  return rng;
}

// ============================================================================
// Test Fixture
// ============================================================================

class PrepareTagTest : public ::testing::Test {
 protected:
  void SetUp() override {
    PW_LOG_INFO("=== PrepareTagTest::SetUp ===");
    auto& reader = GetReader();
    auto status = reader.Init();
    ASSERT_TRUE(status.ok()) << "Reader init failed";
  }

  template <typename Future>
  auto PollUntilReady(pw::async2::DispatcherForTest& dispatcher,
                      Future& future,
                      int max_iterations = 200) {
    for (int i = 0; i < max_iterations; ++i) {
      auto poll = dispatcher.RunInTaskUntilStalled(future);
      if (poll.IsReady()) {
        return poll;
      }
      // Run pending work and wait a bit
      dispatcher.RunUntilStalled();
      HAL_Delay_Milliseconds(10);
    }
    return dispatcher.RunInTaskUntilStalled(future);
  }

  std::optional<maco::nfc::TagInfo> WaitForCard(
      pw::async2::DispatcherForTest& dispatcher,
      TestablePn532Reader& reader) {
    PW_LOG_INFO("=====================================================");
    PW_LOG_INFO("PLACE A FRESH/FACTORY NTAG424 TAG ON THE READER");
    PW_LOG_INFO("(Tag should have default all-zeros key)");
    PW_LOG_INFO("=====================================================");

    // Subscribe BEFORE starting the FSM to not miss the first event
    auto event_future = reader.SubscribeOnce();

    // Start the reader FSM
    reader.Start(dispatcher);

    // Wait for tag arrival event - poll the SAME subscription
    for (int attempt = 0; attempt < 500; ++attempt) {
      // Run dispatcher to process any pending work (including reader task)
      dispatcher.RunUntilStalled();

      // Now poll the future - RunInTaskUntilStalled also runs pending work
      auto poll = dispatcher.RunInTaskUntilStalled(event_future);

      if (attempt < 5 || attempt % 50 == 0) {
        PW_LOG_INFO("  Poll attempt %d: %s", attempt,
                    poll.IsReady() ? "Ready" : "Pending");
      }

      if (poll.IsReady()) {
        auto& event = poll.value();
        PW_LOG_INFO("  Event type: %d, tag: %s",
                    static_cast<int>(event.type),
                    event.tag ? "present" : "null");
        if (event.type == maco::nfc::NfcEventType::kTagArrived && event.tag) {
          PW_LOG_INFO("Card detected!");
          // Reconstruct TagInfo from the tag
          maco::nfc::TagInfo info;
          auto uid = event.tag->uid();
          info.uid_length = uid.size();
          std::copy(uid.begin(), uid.end(), info.uid.begin());
          info.sak = event.tag->sak();
          info.target_number = event.tag->target_number();
          info.supports_iso14443_4 = event.tag->supports_iso14443_4();
          return info;
        }
        if (event.type == maco::nfc::NfcEventType::kTagDeparted) {
          PW_LOG_INFO("  Tag departed, waiting for new tag...");
          // Need a new subscription for the next tag
          event_future = reader.SubscribeOnce();
        }
      }

      HAL_Delay_Milliseconds(10);
    }

    PW_LOG_WARN("No card detected within timeout");
    return std::nullopt;
  }
};

// ============================================================================
// Preparation Test
// ============================================================================

TEST_F(PrepareTagTest, PrepareTagWithTestKey) {
  auto& reader = GetReader();
  pw::async2::DispatcherForTest dispatcher;

  auto tag_info_opt = WaitForCard(dispatcher, reader);
  if (!tag_info_opt) {
    GTEST_SKIP() << "No card present";
  }

  maco::nfc::Ntag424Tag tag(reader, *tag_info_opt);

  // Step 1: Select application
  PW_LOG_INFO("Step 1: Selecting NTAG424 DNA application...");
  {
    auto future = tag.SelectApplication();
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady() && poll.value().ok())
        << "SelectApplication failed";
    PW_LOG_INFO("  OK");
  }

  // Step 2: Authenticate with default key
  PW_LOG_INFO("Step 2: Authenticating with default key (all zeros)...");
  {
    maco::nfc::LocalKeyProvider key_provider(0, kDefaultKey);
    auto future = tag.Authenticate(key_provider, GetRng());
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady()) << "Authenticate did not complete";

    auto result = poll.value();
    if (!result.ok()) {
      PW_LOG_ERROR("Authentication with default key failed!");
      PW_LOG_ERROR("The tag may already have a different key set.");
      PW_LOG_ERROR("Use NXP TagWriter app to reset the tag to factory.");
    }
    ASSERT_TRUE(result.ok()) << "Auth with default key failed";
    PW_LOG_INFO("  OK - Authenticated with default key");
  }

  // Step 3: Change key 0 to test key
  PW_LOG_INFO("Step 3: Changing key 0 to test key...");
  PW_LOG_INFO("  Test key: 00 11 22 33 44 55 66 77 88 99 AA BB CC DD EE FF");
  {
    auto future = tag.ChangeKey(
        0,           // Key number
        kTestKey,    // New key
        0x01,        // Key version
        {}           // No old key needed for key 0 (auth key)
    );
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady()) << "ChangeKey did not complete";

    auto status = poll.value();
    if (!status.ok()) {
      PW_LOG_ERROR("ChangeKey failed: %d", static_cast<int>(status.code()));
    }
    ASSERT_TRUE(status.ok()) << "ChangeKey failed";
    PW_LOG_INFO("  OK - Key changed successfully!");
  }

  // Step 4: Verify by authenticating with new key
  PW_LOG_INFO("Step 4: Verifying by authenticating with new test key...");
  {
    // Need to re-select application after key change clears session
    auto select_future = tag.SelectApplication();
    auto select_poll = PollUntilReady(dispatcher, select_future);
    ASSERT_TRUE(select_poll.IsReady() && select_poll.value().ok());

    maco::nfc::LocalKeyProvider key_provider(0, kTestKey);
    auto future = tag.Authenticate(key_provider, GetRng());
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady()) << "Verify authenticate did not complete";

    auto result = poll.value();
    ASSERT_TRUE(result.ok()) << "Verify authenticate failed!";
    PW_LOG_INFO("  OK - Authenticated with new test key!");
  }

  // Step 5: Get UID to confirm everything works
  PW_LOG_INFO("Step 5: Getting card UID to confirm...");
  {
    std::array<std::byte, 7> uid_buffer{};
    auto future = tag.GetCardUid(uid_buffer);
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady()) << "GetCardUid did not complete";

    auto result = poll.value();
    ASSERT_TRUE(result.ok()) << "GetCardUid failed";

    char uid_str[32] = {0};
    for (size_t i = 0; i < result.value(); i++) {
      snprintf(uid_str + i * 3, 4, "%02X ",
               static_cast<unsigned>(uid_buffer[i]));
    }
    PW_LOG_INFO("  Card UID: %s", uid_str);
  }

  PW_LOG_INFO("=====================================================");
  PW_LOG_INFO("SUCCESS! Tag is now prepared for integration testing.");
  PW_LOG_INFO("The tag's key 0 has been changed to the test key.");
  PW_LOG_INFO("You can now run ntag424_hardware_test.");
  PW_LOG_INFO("=====================================================");
}

// Utility test to reset a tag back to default key
TEST_F(PrepareTagTest, DISABLED_ResetTagToDefaultKey) {
  auto& reader = GetReader();
  pw::async2::DispatcherForTest dispatcher;

  auto tag_info_opt = WaitForCard(dispatcher, reader);
  if (!tag_info_opt) {
    GTEST_SKIP() << "No card present";
  }

  maco::nfc::Ntag424Tag tag(reader, *tag_info_opt);

  PW_LOG_INFO("Resetting tag back to default key...");

  // Select application
  {
    auto future = tag.SelectApplication();
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady() && poll.value().ok());
  }

  // Authenticate with TEST key (current key)
  {
    maco::nfc::LocalKeyProvider key_provider(0, kTestKey);
    auto future = tag.Authenticate(key_provider, GetRng());
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady() && poll.value().ok())
        << "Auth with test key failed - tag may already be reset";
  }

  // Change back to default key
  {
    auto future = tag.ChangeKey(0, kDefaultKey, 0x00, {});
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady() && poll.value().ok())
        << "ChangeKey to default failed";
  }

  PW_LOG_INFO("Tag reset to default key (all zeros)");
}

}  // namespace
