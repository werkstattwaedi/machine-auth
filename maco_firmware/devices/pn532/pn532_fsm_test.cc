// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Unit tests for PN532 NFC reader FSM state transitions.
//
// These tests verify the FSM behavior in isolation.

#include <memory>

#include "pw_unit_test/framework.h"

#include "maco_firmware/devices/pn532/pn532_nfc_reader_fsm.h"
#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"

namespace maco::nfc {
namespace {

// ============================================================================
// Mock Reader Context for FSM Testing
// ============================================================================

/// Minimal test context that tracks FSM callbacks without real hardware.
class MockReaderContext {
 public:
  // Called by FSM states
  void StartDetection() { start_detection_called_ = true; }
  void StartProbe(const TagInfo& info) {
    start_probe_called_ = true;
    last_tag_info_ = info;
  }
  void OnTagProbed(std::shared_ptr<NfcTag>) { on_tag_probed_called_ = true; }
  void SendTagArrived() { send_tag_arrived_called_ = true; }
  void SendTagDeparted() { send_tag_departed_called_ = true; }
  void SchedulePresenceCheck() { schedule_presence_check_called_ = true; }
  void StartPresenceCheck() { start_presence_check_called_ = true; }
  void StartOperation(TransceiveRequest*) { start_operation_called_ = true; }
  void OnOperationComplete(pw::Result<size_t>) {
    on_operation_complete_called_ = true;
  }
  void OnOperationFailed() { on_operation_failed_called_ = true; }
  void OnTagRemoved() { on_tag_removed_called_ = true; }
  void HandleDesync() { handle_desync_called_ = true; }

  // Reset all flags
  void Reset() {
    start_detection_called_ = false;
    start_probe_called_ = false;
    on_tag_probed_called_ = false;
    send_tag_arrived_called_ = false;
    send_tag_departed_called_ = false;
    schedule_presence_check_called_ = false;
    start_presence_check_called_ = false;
    start_operation_called_ = false;
    on_operation_complete_called_ = false;
    on_operation_failed_called_ = false;
    on_tag_removed_called_ = false;
    handle_desync_called_ = false;
  }

  // Accessors
  bool start_detection_called() const { return start_detection_called_; }
  bool start_probe_called() const { return start_probe_called_; }
  bool on_tag_probed_called() const { return on_tag_probed_called_; }
  bool send_tag_arrived_called() const { return send_tag_arrived_called_; }
  bool send_tag_departed_called() const { return send_tag_departed_called_; }
  bool schedule_presence_check_called() const {
    return schedule_presence_check_called_;
  }
  bool start_presence_check_called() const {
    return start_presence_check_called_;
  }
  bool start_operation_called() const { return start_operation_called_; }
  bool on_operation_complete_called() const {
    return on_operation_complete_called_;
  }
  bool on_operation_failed_called() const { return on_operation_failed_called_; }
  bool on_tag_removed_called() const { return on_tag_removed_called_; }
  bool handle_desync_called() const { return handle_desync_called_; }
  const TagInfo& last_tag_info() const { return last_tag_info_; }

 private:
  bool start_detection_called_ = false;
  bool start_probe_called_ = false;
  bool on_tag_probed_called_ = false;
  bool send_tag_arrived_called_ = false;
  bool send_tag_departed_called_ = false;
  bool schedule_presence_check_called_ = false;
  bool start_presence_check_called_ = false;
  bool start_operation_called_ = false;
  bool on_operation_complete_called_ = false;
  bool on_operation_failed_called_ = false;
  bool on_tag_removed_called_ = false;
  bool handle_desync_called_ = false;
  TagInfo last_tag_info_{};
};

// Note: These tests use the FSM messages directly.
// Full integration tests with the reader are in the hardware tests.

// ============================================================================
// FSM State Transition Tests (Message-Based)
// ============================================================================

// Test the basic state IDs and message structure
TEST(Pn532FsmMessageTest, StateIdsAreDistinct) {
  EXPECT_NE(Pn532StateId::kIdle, Pn532StateId::kDetecting);
  EXPECT_NE(Pn532StateId::kDetecting, Pn532StateId::kProbing);
  EXPECT_NE(Pn532StateId::kProbing, Pn532StateId::kSendingEvent);
  EXPECT_NE(Pn532StateId::kSendingEvent, Pn532StateId::kTagPresent);
  EXPECT_NE(Pn532StateId::kTagPresent, Pn532StateId::kCheckingPresence);
  EXPECT_NE(Pn532StateId::kCheckingPresence, Pn532StateId::kExecutingOp);
}

TEST(Pn532FsmMessageTest, MessageIdsAreDistinct) {
  EXPECT_NE(static_cast<int>(Pn532MessageId::kStart),
            static_cast<int>(Pn532MessageId::kTagDetected));
  EXPECT_NE(static_cast<int>(Pn532MessageId::kTagDetected),
            static_cast<int>(Pn532MessageId::kTagNotFound));
  EXPECT_NE(static_cast<int>(Pn532MessageId::kProbeComplete),
            static_cast<int>(Pn532MessageId::kProbeFailed));
}

TEST(Pn532FsmMessageTest, MsgTagDetectedStoresTagInfo) {
  TagInfo info{};
  info.uid_length = 4;
  info.uid[0] = std::byte{0xDE};
  info.uid[1] = std::byte{0xAD};
  info.uid[2] = std::byte{0xBE};
  info.uid[3] = std::byte{0xEF};
  info.sak = 0x20;
  info.target_number = 1;
  info.supports_iso14443_4 = true;

  MsgTagDetected msg{info};

  EXPECT_EQ(msg.info.uid_length, 4u);
  EXPECT_EQ(msg.info.uid[0], std::byte{0xDE});
  EXPECT_EQ(msg.info.sak, 0x20);
  EXPECT_TRUE(msg.info.supports_iso14443_4);
}

TEST(Pn532FsmMessageTest, MsgProbeCompleteStoresNullTag) {
  // Test with nullptr - we can't easily create an NfcTag in tests
  // as it's abstract. The tag would come from the reader in real code.
  std::shared_ptr<NfcTag> tag = nullptr;

  MsgProbeComplete msg{tag};

  EXPECT_EQ(msg.tag, nullptr);
}

TEST(Pn532FsmMessageTest, MsgOpCompleteStoresResult) {
  pw::Result<size_t> result(42);
  MsgOpComplete msg{result};

  EXPECT_TRUE(msg.result.ok());
  EXPECT_EQ(msg.result.value(), 42u);
}

// ============================================================================
// Expected State Transitions (Documentation)
// ============================================================================
//
// These document the expected FSM transitions:
//
// Idle --> (MsgStart) --> Detecting
// Detecting --> (MsgTagDetected) --> Probing
// Detecting --> (MsgTagNotFound) --> Detecting
// Probing --> (MsgProbeComplete) --> SendingEvent
// Probing --> (MsgProbeFailed) --> Detecting
// SendingEvent --> (MsgEventSent) --> TagPresent
// TagPresent --> (MsgAppRequest) --> ExecutingOp
// TagPresent --> (MsgPresenceCheckDue) --> CheckingPresence
// CheckingPresence --> (MsgTagPresent) --> TagPresent
// CheckingPresence --> (MsgTagGone) --> SendingEvent
// ExecutingOp --> (MsgOpComplete) --> TagPresent
// ExecutingOp --> (MsgOpFailed) --> SendingEvent
//
// Note: Full FSM integration tests are in hardware_test.cc and
// the prepare_tag.cc hardware test.

// ============================================================================
// Deferred Probe Completion Pattern (Documentation)
// ============================================================================
//
// The ETL FSM library does not support nested fsm_.receive() calls.
// When MsgTagDetected is received in Detecting state:
// 1. StartProbe() is called
// 2. StartProbe() stores the probe result and sets probe_complete_pending_
// 3. The DoPend() task checks for probe_complete_pending_ when in Probing state
// 4. DoPend() sends MsgProbeComplete to complete the transition
//
// This pattern was identified and fixed when the hardware test was hanging
// after tag detection (FSM stayed in kProbing state instead of transitioning
// to kSendingEvent).

}  // namespace
}  // namespace maco::nfc
