// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// On-device hardware integration test for NTAG424 DNA.
// Requires a tag prepared with ntag424_prepare_tag utility.
//
// Test categories:
// - Authentication: AuthenticateEV2First with test key
// - GetCardUid: Retrieve encrypted UID
// - ReadData: Read file data with Full mode
// - WriteData: Write and verify file data

// Pigweed headers first (avoid macro pollution from HAL)
#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag_async.h"
#include "pb_digital_io/digital_io.h"
#include "pb_stream/uart_stream.h"
#include "pw_async2/dispatcher_for_test.h"

#define PW_LOG_MODULE_NAME "ntag424"

#include "pw_log/log.h"
#include "pw_thread/sleep.h"
#include "pw_unit_test/framework.h"

// HAL headers after Pigweed
#include "delay_hal.h"
#include "gpio_hal.h"
#include "pinmap_hal.h"
#include "rng_hal.h"

namespace {
using namespace std::chrono_literals;

// Pin definitions for PN532 NFC controller
constexpr hal_pin_t kPinNfcReset = S1;
constexpr uint32_t kUartBaudRate = 115200;

// Timeouts
constexpr auto kRfOperationTimeout = std::chrono::milliseconds(500);
constexpr auto kCardWaitTimeout = std::chrono::seconds(10);

// ============================================================================
// Test Keys and Configuration
// ============================================================================

// Test key for NTAG424 - use ntag424_prepare_tag to set this on a fresh tag.
// This is NOT a secret - it's a known test key for integration testing.
constexpr std::array<std::byte, 16> kTestKey = {
    std::byte{0x00}, std::byte{0x11}, std::byte{0x22}, std::byte{0x33},
    std::byte{0x44}, std::byte{0x55}, std::byte{0x66}, std::byte{0x77},
    std::byte{0x88}, std::byte{0x99}, std::byte{0xAA}, std::byte{0xBB},
    std::byte{0xCC}, std::byte{0xDD}, std::byte{0xEE}, std::byte{0xFF},
};

// Default factory key (all zeros) - used by prepare_tag utility
constexpr std::array<std::byte, 16> kDefaultKey = {};

// Test file number (NDEF file, usually writable)
constexpr uint8_t kTestFileNumber = 0x02;

// Test data pattern
constexpr std::array<std::byte, 16> kTestPattern = {
    std::byte{0xDE}, std::byte{0xAD}, std::byte{0xBE}, std::byte{0xEF},
    std::byte{0xCA}, std::byte{0xFE}, std::byte{0xBA}, std::byte{0xBE},
    std::byte{0x01}, std::byte{0x23}, std::byte{0x45}, std::byte{0x67},
    std::byte{0x89}, std::byte{0xAB}, std::byte{0xCD}, std::byte{0xEF},
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

/// Hardware random generator using Device OS HAL.
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

class Ntag424HardwareTest : public ::testing::Test {
 protected:
  void SetUp() override {
    PW_LOG_INFO("=== Ntag424HardwareTest::SetUp ===");
    auto& reader = GetReader();
    auto status = reader.Init();
    ASSERT_TRUE(status.ok()) << "Reader init failed";
  }

  void TearDown() override {
    PW_LOG_INFO("=== Ntag424HardwareTest::TearDown ===");
  }

  /// Poll a future until ready or max iterations (iterations * 10ms).
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

  /// Wait for a card and return TagInfo (uses proper FSM flow).
  std::optional<maco::nfc::TagInfo> WaitForCard(
      pw::async2::DispatcherForTest& dispatcher,
      TestablePn532Reader& reader) {
    PW_LOG_INFO("=================================================");
    PW_LOG_INFO("PLACE PREPARED NTAG424 TAG ON READER");
    PW_LOG_INFO("(Use ntag424_prepare_tag first if needed)");
    PW_LOG_INFO("=================================================");

    // Subscribe BEFORE starting the FSM to not miss the first event
    auto event_future = reader.SubscribeOnce();

    // Start the reader FSM
    reader.Start(dispatcher);

    // Wait for tag arrival event - poll the SAME subscription
    for (int attempt = 0; attempt < 500; ++attempt) {
      auto poll = dispatcher.RunInTaskUntilStalled(event_future);
      if (poll.IsReady()) {
        auto& event = poll.value();
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

      // Run pending work and wait a bit
      dispatcher.RunUntilStalled();
      HAL_Delay_Milliseconds(10);

      if (attempt % 100 == 0) {
        PW_LOG_INFO("  Waiting for card... (%d/500)", attempt);
      }
    }

    PW_LOG_WARN("No card detected within timeout");
    return std::nullopt;
  }
};

// ============================================================================
// Tests
// ============================================================================

TEST_F(Ntag424HardwareTest, SelectApplication_Succeeds) {
  auto& reader = GetReader();
  pw::async2::DispatcherForTest dispatcher;

  auto tag_info_opt = WaitForCard(dispatcher, reader);
  if (!tag_info_opt) {
    GTEST_SKIP() << "No card present";
  }

  // Create tag instance
  maco::nfc::Ntag424Tag tag(reader, *tag_info_opt);

  PW_LOG_INFO("Selecting NTAG424 DNA application...");

  auto future = tag.SelectApplication();
  auto poll = PollUntilReady(dispatcher, future);
  ASSERT_TRUE(poll.IsReady()) << "SelectApplication did not complete";

  auto status = poll.value();
  EXPECT_TRUE(status.ok()) << "SelectApplication failed: "
                           << static_cast<int>(status.code());

  if (status.ok()) {
    PW_LOG_INFO("SelectApplication succeeded!");
  }
}

TEST_F(Ntag424HardwareTest, Authenticate_WithTestKey) {
  auto& reader = GetReader();
  pw::async2::DispatcherForTest dispatcher;

  auto tag_info_opt = WaitForCard(dispatcher, reader);
  if (!tag_info_opt) {
    GTEST_SKIP() << "No card present";
  }

  maco::nfc::Ntag424Tag tag(reader, *tag_info_opt);

  // Select application first
  {
    auto future = tag.SelectApplication();
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady() && poll.value().ok())
        << "SelectApplication failed";
  }

  PW_LOG_INFO("Authenticating with test key (key 0)...");

  // Create key provider with test key
  maco::nfc::LocalKeyProvider key_provider(0, kTestKey);

  auto future = tag.Authenticate(key_provider, GetRng());
  auto poll = PollUntilReady(dispatcher, future);
  ASSERT_TRUE(poll.IsReady()) << "Authenticate did not complete";

  auto result = poll.value();
  if (!result.ok()) {
    PW_LOG_ERROR("Authentication failed: %d",
                 static_cast<int>(result.status().code()));
    PW_LOG_ERROR("Make sure the tag is prepared with the test key!");
    PW_LOG_ERROR("Run: bazel run //maco_firmware/.../ntag424:prepare_tag_flash");
  }
  ASSERT_TRUE(result.ok()) << "Authentication failed - is tag prepared?";

  PW_LOG_INFO("Authentication succeeded!");
  EXPECT_TRUE(tag.is_authenticated());
}

TEST_F(Ntag424HardwareTest, GetCardUid_ReturnsValidUid) {
  auto& reader = GetReader();
  pw::async2::DispatcherForTest dispatcher;

  auto tag_info_opt = WaitForCard(dispatcher, reader);
  if (!tag_info_opt) {
    GTEST_SKIP() << "No card present";
  }

  maco::nfc::Ntag424Tag tag(reader, *tag_info_opt);

  // Select and authenticate
  {
    auto future = tag.SelectApplication();
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady() && poll.value().ok());
  }
  {
    maco::nfc::LocalKeyProvider key_provider(0, kTestKey);
    auto future = tag.Authenticate(key_provider, GetRng());
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady() && poll.value().ok())
        << "Authentication failed - is tag prepared?";
  }

  PW_LOG_INFO("Getting encrypted card UID...");

  std::array<std::byte, 7> uid_buffer{};
  auto future = tag.GetCardUid(uid_buffer);
  auto poll = PollUntilReady(dispatcher, future);
  ASSERT_TRUE(poll.IsReady()) << "GetCardUid did not complete";

  auto result = poll.value();
  ASSERT_TRUE(result.ok()) << "GetCardUid failed: "
                           << static_cast<int>(result.status().code());

  size_t uid_len = result.value();
  EXPECT_EQ(uid_len, 7u) << "UID should be 7 bytes";

  // Log UID
  char uid_str[32] = {0};
  for (size_t i = 0; i < uid_len; i++) {
    snprintf(uid_str + i * 3, 4, "%02X ",
             static_cast<unsigned>(uid_buffer[i]));
  }
  PW_LOG_INFO("Card UID: %s", uid_str);
}

TEST_F(Ntag424HardwareTest, WriteAndReadData_RoundTrip) {
  auto& reader = GetReader();
  pw::async2::DispatcherForTest dispatcher;

  auto tag_info_opt = WaitForCard(dispatcher, reader);
  if (!tag_info_opt) {
    GTEST_SKIP() << "No card present";
  }

  maco::nfc::Ntag424Tag tag(reader, *tag_info_opt);

  // Select and authenticate
  {
    auto future = tag.SelectApplication();
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady() && poll.value().ok());
  }
  {
    maco::nfc::LocalKeyProvider key_provider(0, kTestKey);
    auto future = tag.Authenticate(key_provider, GetRng());
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady() && poll.value().ok())
        << "Authentication failed - is tag prepared?";
  }

  // Generate unique test data using random number
  std::array<std::byte, 16> write_data = kTestPattern;
  uint32_t random_seed = HAL_RNG_GetRandomNumber();
  write_data[0] = static_cast<std::byte>(random_seed & 0xFF);
  write_data[1] = static_cast<std::byte>((random_seed >> 8) & 0xFF);

  PW_LOG_INFO("Writing %u bytes to file %u...",
              static_cast<unsigned>(write_data.size()), kTestFileNumber);

  // Write data
  {
    auto future = tag.WriteData(kTestFileNumber, 0, write_data,
                                maco::nfc::CommMode::kFull);
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady()) << "WriteData did not complete";

    auto status = poll.value();
    ASSERT_TRUE(status.ok()) << "WriteData failed: "
                             << static_cast<int>(status.code());
    PW_LOG_INFO("WriteData succeeded!");
  }

  // Need to re-authenticate after counter increment
  // (or we could track the counter, but re-auth is simpler for testing)
  {
    maco::nfc::LocalKeyProvider key_provider(0, kTestKey);
    auto future = tag.Authenticate(key_provider, GetRng());
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady() && poll.value().ok())
        << "Re-authentication failed";
  }

  PW_LOG_INFO("Reading back data...");

  // Read data back
  std::array<std::byte, 16> read_buffer{};
  {
    auto future = tag.ReadData(kTestFileNumber, 0, 16, read_buffer,
                               maco::nfc::CommMode::kFull);
    auto poll = PollUntilReady(dispatcher, future);
    ASSERT_TRUE(poll.IsReady()) << "ReadData did not complete";

    auto result = poll.value();
    ASSERT_TRUE(result.ok()) << "ReadData failed: "
                             << static_cast<int>(result.status().code());

    size_t bytes_read = result.value();
    EXPECT_EQ(bytes_read, 16u);
    PW_LOG_INFO("ReadData returned %u bytes", static_cast<unsigned>(bytes_read));
  }

  // Verify data matches
  bool match = std::equal(write_data.begin(), write_data.end(),
                          read_buffer.begin());
  if (!match) {
    PW_LOG_ERROR("Data mismatch!");
    PW_LOG_ERROR("  Written: %02X %02X %02X %02X...",
                 static_cast<int>(write_data[0]),
                 static_cast<int>(write_data[1]),
                 static_cast<int>(write_data[2]),
                 static_cast<int>(write_data[3]));
    PW_LOG_ERROR("  Read:    %02X %02X %02X %02X...",
                 static_cast<int>(read_buffer[0]),
                 static_cast<int>(read_buffer[1]),
                 static_cast<int>(read_buffer[2]),
                 static_cast<int>(read_buffer[3]));
  }
  EXPECT_TRUE(match) << "Written and read data should match";

  if (match) {
    PW_LOG_INFO("SUCCESS! Write/Read round-trip verified!");
  }
}

}  // namespace
