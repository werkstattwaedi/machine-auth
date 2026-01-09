// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_reader/nfc_reader.h"

#include "maco_firmware/modules/nfc_reader/nfc_reader_driver.h"
#include "pw_bytes/array.h"
#include "pw_unit_test/framework.h"

namespace maco::nfc {
namespace {

/// Simple synchronous mock future for testing.
///
/// Unlike pw_async2's ValueFuture which uses Pend(Context&), this provides
/// IsReady()/Take() methods that NfcReader::PollOnce() expects.
template <typename T>
class MockFuture {
 public:
  explicit MockFuture(T value) : value_(std::move(value)), ready_(true) {}

  bool IsReady() const { return ready_; }

  T Take() {
    ready_ = false;
    return std::move(value_);
  }

 private:
  T value_;
  bool ready_;
};

/// Mock NFC driver for testing NfcReader.
///
/// Returns MockFuture instances that are immediately ready with configured
/// results.
class MockNfcDriver : public NfcReaderDriverBase<MockNfcDriver> {
 public:
  // Results that will be returned by futures
  pw::Result<TagInfo> detect_result = pw::Status::NotFound();
  pw::Result<bool> check_present_result = true;
  pw::Result<size_t> transceive_result = pw::Status::Unavailable();

  // Track method calls
  int detect_tag_calls = 0;
  int check_present_calls = 0;
  int transceive_calls = 0;
  int release_tag_calls = 0;
  int recover_from_desync_calls = 0;
  uint8_t last_released_target = 0;

  pw::Status DoInit() { return pw::OkStatus(); }

  pw::Status DoReset() { return pw::OkStatus(); }

  MockFuture<pw::Result<TagInfo>>
  DoDetectTag(pw::chrono::SystemClock::duration /*timeout*/) {
    detect_tag_calls++;
    return MockFuture<pw::Result<TagInfo>>(detect_result);
  }

  MockFuture<pw::Result<size_t>> DoTransceive(
      pw::ConstByteSpan /*command*/,
      pw::ByteSpan /*response_buffer*/,
      pw::chrono::SystemClock::duration /*timeout*/
  ) {
    transceive_calls++;
    return MockFuture<pw::Result<size_t>>(transceive_result);
  }

  MockFuture<pw::Result<bool>>
  DoCheckTagPresent(pw::chrono::SystemClock::duration /*timeout*/) {
    check_present_calls++;
    return MockFuture<pw::Result<bool>>(check_present_result);
  }

  pw::Status DoReleaseTag(uint8_t target_number) {
    release_tag_calls++;
    last_released_target = target_number;
    return pw::OkStatus();
  }

  pw::Status RecoverFromDesync() {
    recover_from_desync_calls++;
    return pw::OkStatus();
  }
};

/// Create a TagInfo with test data.
TagInfo MakeTestTagInfo(uint8_t target_number = 1, uint8_t sak = 0x20) {
  TagInfo info{};
  info.uid = pw::bytes::
      Array<0x01, 0x02, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00>();
  info.uid_length = 4;
  info.sak = sak;
  info.target_number = target_number;
  info.supports_iso14443_4 = (sak & 0x20) != 0;
  return info;
}

//=============================================================================
// NfcReader initialization tests
//=============================================================================

TEST(NfcReaderTest, Init_CallsDriverInit) {
  MockNfcDriver driver;
  NfcReader<MockNfcDriver> reader(driver);

  EXPECT_EQ(reader.Init(), pw::OkStatus());
}

TEST(NfcReaderTest, InitialState_NoTag) {
  MockNfcDriver driver;
  NfcReader<MockNfcDriver> reader(driver);

  EXPECT_FALSE(reader.HasTag());
  EXPECT_EQ(reader.GetCurrentTag(), nullptr);
}

//=============================================================================
// Direct method tests (bypassing FSM)
// Note: FSM requires proper state registration which is complex to set up.
// These tests verify the individual methods work correctly.
//=============================================================================

TEST(NfcReaderTest, StartDetection_CallsDriver) {
  MockNfcDriver driver;
  NfcReader<MockNfcDriver> reader(driver);
  (void)reader.Init();

  // Manually call StartDetection
  reader.StartDetection();

  EXPECT_EQ(driver.detect_tag_calls, 1);
}

TEST(NfcReaderTest, StartPresenceCheck_CallsDriver) {
  MockNfcDriver driver;
  NfcReader<MockNfcDriver> reader(driver);
  (void)reader.Init();

  // Manually call StartPresenceCheck
  reader.StartPresenceCheck();

  EXPECT_EQ(driver.check_present_calls, 1);
}

TEST(NfcReaderTest, OnTagRemoved_ReleasesTag) {
  MockNfcDriver driver;
  NfcReader<MockNfcDriver> reader(driver);
  (void)reader.Init();

  // Manually create and set up a tag via StartProbe + CompleteProbe +
  // OnTagProbed
  TagInfo info = MakeTestTagInfo(3, 0x20);
  reader.StartProbe(info);
  reader.OnTagProbed(reader.CompleteProbe());

  // Verify tag was created
  EXPECT_TRUE(reader.HasTag());
  auto tag = reader.GetCurrentTag();
  EXPECT_TRUE(tag->is_valid());
  EXPECT_EQ(tag->target_number(), uint8_t{3});

  // Now remove the tag
  reader.OnTagRemoved();

  // Verify tag was released
  EXPECT_FALSE(reader.HasTag());
  EXPECT_FALSE(tag->is_valid());
  EXPECT_EQ(driver.release_tag_calls, 1);
  EXPECT_EQ(driver.last_released_target, uint8_t{3});
}

TEST(NfcReaderTest, HandleDesync_CallsRecovery) {
  MockNfcDriver driver;
  NfcReader<MockNfcDriver> reader(driver);
  (void)reader.Init();

  reader.HandleDesync();

  EXPECT_EQ(driver.recover_from_desync_calls, 1);
}

TEST(NfcReaderTest, StartProbe_CreatesTag) {
  MockNfcDriver driver;
  NfcReader<MockNfcDriver> reader(driver);
  (void)reader.Init();

  TagInfo info = MakeTestTagInfo(1, 0x20);
  reader.StartProbe(info);
  reader.OnTagProbed(reader.CompleteProbe());

  EXPECT_TRUE(reader.HasTag());
  auto tag = reader.GetCurrentTag();
  EXPECT_NE(tag, nullptr);
  EXPECT_EQ(tag->sak(), uint8_t{0x20});
  EXPECT_EQ(tag->target_number(), uint8_t{1});
  EXPECT_TRUE(tag->supports_iso14443_4());
}

TEST(NfcReaderTest, StartProbe_NonIso14443Tag) {
  MockNfcDriver driver;
  NfcReader<MockNfcDriver> reader(driver);
  (void)reader.Init();

  // SAK without bit 5 set = not ISO14443-4
  TagInfo info = MakeTestTagInfo(1, 0x00);
  reader.StartProbe(info);
  reader.OnTagProbed(reader.CompleteProbe());

  EXPECT_TRUE(reader.HasTag());
  auto tag = reader.GetCurrentTag();
  EXPECT_FALSE(tag->supports_iso14443_4());
}

TEST(NfcReaderTest, TagInvalidation_OnRemoval) {
  MockNfcDriver driver;
  NfcReader<MockNfcDriver> reader(driver);
  (void)reader.Init();

  TagInfo info = MakeTestTagInfo();
  reader.StartProbe(info);
  reader.OnTagProbed(reader.CompleteProbe());

  auto tag = reader.GetCurrentTag();
  EXPECT_TRUE(tag->is_valid());

  reader.OnTagRemoved();

  // The tag should now be invalid
  EXPECT_FALSE(tag->is_valid());
}

//=============================================================================
// Configuration tests
//=============================================================================

TEST(NfcReaderTest, CustomConfig) {
  MockNfcDriver driver;

  NfcReaderConfig config;
  config.detection_timeout = std::chrono::milliseconds(1000);
  config.presence_check_interval = std::chrono::milliseconds(500);

  NfcReader<MockNfcDriver> reader(driver, config);
  (void)reader.Init();

  // Config should be applied - the reader initializes correctly
  EXPECT_FALSE(reader.HasTag());
}

//=============================================================================
// FSM Integration Tests
// These tests exercise the full state machine via Start() + PollOnce()
//=============================================================================

/// Test fixture for FSM integration tests.
/// Sets up reader with Init() only - tests must configure driver and call
/// Start().
class NfcReaderFsmTest : public ::testing::Test {
 protected:
  void SetUp() override { (void)reader_.Init(); }

  MockNfcDriver driver_;
  NfcReader<MockNfcDriver> reader_{driver_};
};

TEST_F(NfcReaderFsmTest, Start_BeginsDetection) {
  // Start the FSM
  reader_.Start();

  // After Start(), reader should have started detection
  EXPECT_GE(driver_.detect_tag_calls, 1);
  EXPECT_EQ(reader_.GetState(), NfcReaderStateId::kDetecting);
}

TEST_F(NfcReaderFsmTest, PollOnce_TagDetected_CreatesTagAndTransitions) {
  // Configure driver to return a tag BEFORE Start()
  driver_.detect_result = MakeTestTagInfo(1, 0x20);

  // Start the FSM (creates detect future with configured result)
  reader_.Start();

  // Poll once - should process detect future and complete the flow
  reader_.PollOnce();

  // Verify tag was created and we're in TagPresent state
  EXPECT_TRUE(reader_.HasTag());
  EXPECT_EQ(reader_.GetState(), NfcReaderStateId::kTagPresent);
  auto tag = reader_.GetCurrentTag();
  EXPECT_NE(tag, nullptr);
  EXPECT_EQ(tag->sak(), uint8_t{0x20});
}

TEST_F(NfcReaderFsmTest, PollOnce_TagNotFound_RestartsDetection) {
  // Configure driver to return not found (default)
  driver_.detect_result = pw::Status::NotFound();

  // Start the FSM
  reader_.Start();

  // Poll once - should process detect future
  reader_.PollOnce();

  // Should have gone back to Idle and restarted detection
  EXPECT_FALSE(reader_.HasTag());
  // Idle auto-transitions back to Detecting, so we should see multiple calls
  EXPECT_GE(driver_.detect_tag_calls, 2);
}

TEST_F(NfcReaderFsmTest, PresenceCheck_TagStillPresent_StaysInTagPresent) {
  // First, get a tag detected
  driver_.detect_result = MakeTestTagInfo();
  reader_.Start();
  reader_.PollOnce();
  ASSERT_TRUE(reader_.HasTag());
  ASSERT_EQ(reader_.GetState(), NfcReaderStateId::kTagPresent);

  // Configure presence check to succeed
  driver_.check_present_result = true;

  // Force timer to expire and trigger presence check via FSM
  reader_.ForcePresenceCheckDue();
  reader_.PollOnce(
  );  // Triggers MsgPresenceCheckDue -> StartPresenceCheck + kCheckingPresence
  reader_.PollOnce(
  );  // Processes check_future_ -> MsgTagPresent -> kTagPresent

  // Should still have tag and be in TagPresent
  EXPECT_TRUE(reader_.HasTag());
  EXPECT_EQ(reader_.GetState(), NfcReaderStateId::kTagPresent);
  EXPECT_EQ(driver_.check_present_calls, 1);
}

TEST_F(NfcReaderFsmTest, PresenceCheck_TagGone_RemovesTagAndInvalidates) {
  // Get a tag first
  driver_.detect_result = MakeTestTagInfo(2, 0x20);
  reader_.Start();
  reader_.PollOnce();
  auto tag = reader_.GetCurrentTag();
  ASSERT_TRUE(tag->is_valid());

  // Configure presence check to fail (tag gone) and prevent re-detection
  driver_.check_present_result = false;
  driver_.detect_result = pw::Status::NotFound();

  // Force timer to expire and trigger presence check via FSM
  reader_.ForcePresenceCheckDue();
  reader_.PollOnce(
  );  // Triggers MsgPresenceCheckDue -> StartPresenceCheck + kCheckingPresence
  reader_.PollOnce();  // Processes check_future_ -> MsgTagGone -> OnTagRemoved

  // Tag should be removed and invalidated
  EXPECT_FALSE(reader_.HasTag());
  EXPECT_FALSE(tag->is_valid());
  EXPECT_EQ(driver_.release_tag_calls, 1);
  EXPECT_EQ(driver_.last_released_target, uint8_t{2});
}

TEST_F(NfcReaderFsmTest, PollOnce_DesyncError_CallsRecoveryAndResets) {
  // Configure driver to return desync error (Internal status)
  driver_.detect_result = pw::Status::Internal();

  // Start the FSM
  reader_.Start();

  // Poll once - should handle desync
  reader_.PollOnce();

  // Recovery should have been called
  EXPECT_EQ(driver_.recover_from_desync_calls, 1);
  // Should restart (go back to Idle which auto-starts detection)
  EXPECT_EQ(reader_.GetState(), NfcReaderStateId::kDetecting);
}

TEST_F(NfcReaderFsmTest, PresenceCheck_DeadlineExceeded_TreatedAsTagGone) {
  // Get a tag first
  driver_.detect_result = MakeTestTagInfo();
  reader_.Start();
  reader_.PollOnce();
  ASSERT_TRUE(reader_.HasTag());

  // Configure presence check to timeout (tag gone error) and prevent
  // re-detection
  driver_.check_present_result = pw::Status::DeadlineExceeded();
  driver_.detect_result = pw::Status::NotFound();

  // Force timer to expire and trigger presence check via FSM
  reader_.ForcePresenceCheckDue();
  reader_.PollOnce(
  );  // Triggers MsgPresenceCheckDue -> StartPresenceCheck + kCheckingPresence
  reader_.PollOnce();  // Processes check_future_ -> MsgTagGone

  // Tag should be removed (timeout = tag gone)
  EXPECT_FALSE(reader_.HasTag());
  EXPECT_EQ(driver_.release_tag_calls, 1);
}

TEST_F(NfcReaderFsmTest, PresenceCheck_DataLoss_TreatedAsTagGone) {
  // Get a tag first
  driver_.detect_result = MakeTestTagInfo();
  reader_.Start();
  reader_.PollOnce();
  ASSERT_TRUE(reader_.HasTag());

  // Configure presence check to return CRC/framing error (tag gone) and prevent
  // re-detection
  driver_.check_present_result = pw::Status::DataLoss();
  driver_.detect_result = pw::Status::NotFound();

  // Force timer to expire and trigger presence check via FSM
  reader_.ForcePresenceCheckDue();
  reader_.PollOnce(
  );  // Triggers MsgPresenceCheckDue -> StartPresenceCheck + kCheckingPresence
  reader_.PollOnce();  // Processes check_future_ -> MsgTagGone

  // Tag should be removed
  EXPECT_FALSE(reader_.HasTag());
}

//=============================================================================
// TransceiveRequestFuture tests
//=============================================================================

TEST(TransceiveRequestFutureTest, IsReady_ReturnsFalse_WhenNotCompleted) {
  TransceiveRequest request{
      .command = {},
      .response_buffer = {},
      .timeout = std::chrono::milliseconds(100),
      .result = std::nullopt,
      .completed = false
  };

  TransceiveRequestFuture future(&request);

  EXPECT_FALSE(future.IsReady());
}

TEST(TransceiveRequestFutureTest, IsReady_ReturnsTrue_WhenCompleted) {
  TransceiveRequest request{
      .command = {},
      .response_buffer = {},
      .timeout = std::chrono::milliseconds(100),
      .result = std::nullopt,
      .completed = false
  };

  TransceiveRequestFuture future(&request);

  // Complete the request
  request.Complete(pw::Result<size_t>(42));

  EXPECT_TRUE(future.IsReady());
}

TEST(TransceiveRequestFutureTest, Take_ReturnsResult) {
  TransceiveRequest request{
      .command = {},
      .response_buffer = {},
      .timeout = std::chrono::milliseconds(100),
      .result = std::nullopt,
      .completed = false
  };

  TransceiveRequestFuture future(&request);
  request.Complete(pw::Result<size_t>(123));

  auto result = future.Take();
  EXPECT_TRUE(result.ok());
  EXPECT_EQ(result.value(), size_t{123});
}

TEST(TransceiveRequestFutureTest, Take_ReturnsError) {
  TransceiveRequest request{
      .command = {},
      .response_buffer = {},
      .timeout = std::chrono::milliseconds(100),
      .result = std::nullopt,
      .completed = false
  };

  TransceiveRequestFuture future(&request);
  request.Complete(pw::Status::Unavailable());

  auto result = future.Take();
  EXPECT_FALSE(result.ok());
  EXPECT_EQ(result.status(), pw::Status::Unavailable());
}

TEST(NfcReaderTest, RequestTransceive_ReturnsFuture) {
  MockNfcDriver driver;
  NfcReader<MockNfcDriver> reader(driver);
  (void)reader.Init();

  std::array<std::byte, 4> cmd = {std::byte{0x00}};
  std::array<std::byte, 64> response;

  auto future = reader.RequestTransceive(
      pw::ConstByteSpan(cmd),
      pw::ByteSpan(response),
      std::chrono::milliseconds(100)
  );

  // Future should not be ready yet (request is pending)
  EXPECT_FALSE(future.IsReady());
}

}  // namespace
}  // namespace maco::nfc
