// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/app_state/session_fsm.h"

#include "pw_bytes/array.h"
#include "pw_unit_test/framework.h"

namespace maco::app_state {
namespace {

// Test helpers

maco::TagUid MakeTagUid(std::byte b) {
  return maco::TagUid::FromArray(
      {b, std::byte{0}, std::byte{0}, std::byte{0},
       std::byte{0}, std::byte{0}, std::byte{0}});
}

session_event::UserAuthorized MakeAuthEvent(
    maco::TagUid tag_uid,
    const char* user_label = "Test User") {
  return session_event::UserAuthorized(
      tag_uid,
      *maco::FirebaseId::FromString("user_123"),
      pw::InlineString<64>(user_label),
      *maco::FirebaseId::FromString("auth_456"));
}

// Mock observer to track notifications
class MockObserver : public SessionObserver {
 public:
  void OnSessionStarted(const SessionInfo& session) override {
    start_count++;
    last_started_label = session.user_label;
  }

  void OnSessionEnded(const SessionInfo& session,
                      const MachineUsage& usage) override {
    end_count++;
    last_ended_label = session.user_label;
    last_checkout_reason = usage.reason;
  }

  int start_count = 0;
  int end_count = 0;
  pw::InlineString<64> last_started_label;
  pw::InlineString<64> last_ended_label;
  CheckoutReason last_checkout_reason = CheckoutReason::kNone;
};

// --- Basic state tests ---

TEST(SessionFsmTest, InitialStateIsNoSession) {
  SessionFsm fsm;
  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kNoSession);
}

TEST(SessionFsmTest, SnapshotInitialState) {
  SessionFsm fsm;
  fsm.SyncSnapshot();

  SessionSnapshotUi snapshot;
  fsm.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, SessionStateUi::kNoSession);
  EXPECT_TRUE(snapshot.session_user_label.empty());
  EXPECT_FALSE(snapshot.tag_present);
}

// --- NoSession → Active/Running ---

TEST(SessionFsmTest, UserAuthorizedStartsSession) {
  SessionFsm fsm;
  auto tag = MakeTagUid(std::byte{0x01});

  fsm.receive(MakeAuthEvent(tag));

  // Should be in Running (child of Active)
  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kRunning);
}

TEST(SessionFsmTest, SessionStartNotifiesObserver) {
  SessionFsm fsm;
  MockObserver observer;
  fsm.AddObserver(&observer);

  fsm.receive(MakeAuthEvent(MakeTagUid(std::byte{0x01}), "Alice"));

  EXPECT_EQ(observer.start_count, 1);
  EXPECT_EQ(std::string_view(observer.last_started_label), "Alice");
}

TEST(SessionFsmTest, SnapshotDuringSession) {
  SessionFsm fsm;
  auto tag = MakeTagUid(std::byte{0x01});

  fsm.receive(MakeAuthEvent(tag, "Alice"));
  fsm.SyncSnapshot();

  SessionSnapshotUi snapshot;
  fsm.GetSnapshot(snapshot);
  EXPECT_EQ(snapshot.state, SessionStateUi::kRunning);
  EXPECT_EQ(std::string_view(snapshot.session_user_label), "Alice");
}

// --- Checkout flow (same tag re-tap) ---

TEST(SessionFsmTest, SameTagTransitionsToCheckoutPending) {
  SessionFsm fsm;
  auto tag = MakeTagUid(std::byte{0x01});

  fsm.receive(MakeAuthEvent(tag));
  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kRunning);

  // Same tag again
  fsm.receive(MakeAuthEvent(tag));
  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kCheckoutPending);
}

TEST(SessionFsmTest, CheckoutHoldConfirmedEndsSession) {
  SessionFsm fsm;
  MockObserver observer;
  fsm.AddObserver(&observer);
  auto tag = MakeTagUid(std::byte{0x01});

  fsm.receive(MakeAuthEvent(tag, "Alice"));
  fsm.receive(MakeAuthEvent(tag));
  fsm.receive(session_event::HoldConfirmed{});

  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kNoSession);
  EXPECT_EQ(observer.end_count, 1);
  EXPECT_EQ(observer.last_checkout_reason, CheckoutReason::kSelfCheckout);
}

TEST(SessionFsmTest, CheckoutUiConfirmEndsSession) {
  SessionFsm fsm;
  MockObserver observer;
  fsm.AddObserver(&observer);
  auto tag = MakeTagUid(std::byte{0x01});

  fsm.receive(MakeAuthEvent(tag, "Alice"));
  fsm.receive(MakeAuthEvent(tag));
  fsm.receive(session_event::UiConfirm{});

  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kNoSession);
  EXPECT_EQ(observer.end_count, 1);
  EXPECT_EQ(observer.last_checkout_reason, CheckoutReason::kUiCheckout);
}

TEST(SessionFsmTest, CheckoutCancelReturnsToRunning) {
  SessionFsm fsm;
  MockObserver observer;
  fsm.AddObserver(&observer);
  auto tag = MakeTagUid(std::byte{0x01});

  fsm.receive(MakeAuthEvent(tag));
  fsm.receive(MakeAuthEvent(tag));
  fsm.receive(session_event::UiCancel{});

  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kRunning);
  EXPECT_EQ(observer.end_count, 0);  // Session still active
}

TEST(SessionFsmTest, CheckoutTagRemovedReturnsToRunning) {
  SessionFsm fsm;
  auto tag = MakeTagUid(std::byte{0x01});

  fsm.receive(MakeAuthEvent(tag));
  fsm.receive(MakeAuthEvent(tag));
  fsm.receive(session_event::TagPresence(false));

  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kRunning);
}

TEST(SessionFsmTest, CheckoutTimeoutReturnsToRunning) {
  SessionFsm fsm;
  auto tag = MakeTagUid(std::byte{0x01});

  fsm.receive(MakeAuthEvent(tag));
  fsm.receive(MakeAuthEvent(tag));
  fsm.receive(session_event::Timeout{});

  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kRunning);
}

// --- Takeover flow (different tag) ---

TEST(SessionFsmTest, DifferentTagTransitionsToTakeoverPending) {
  SessionFsm fsm;
  auto tag1 = MakeTagUid(std::byte{0x01});
  auto tag2 = MakeTagUid(std::byte{0x02});

  fsm.receive(MakeAuthEvent(tag1, "Alice"));
  fsm.receive(MakeAuthEvent(tag2, "Bob"));

  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kTakeoverPending);
}

TEST(SessionFsmTest, TakeoverConfirmEndsOldStartsNew) {
  SessionFsm fsm;
  MockObserver observer;
  fsm.AddObserver(&observer);
  auto tag1 = MakeTagUid(std::byte{0x01});
  auto tag2 = MakeTagUid(std::byte{0x02});

  fsm.receive(MakeAuthEvent(tag1, "Alice"));
  EXPECT_EQ(observer.start_count, 1);

  fsm.receive(MakeAuthEvent(tag2, "Bob"));
  fsm.receive(session_event::HoldConfirmed{});

  // Old session ended, new one started
  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kRunning);
  EXPECT_EQ(observer.end_count, 1);
  EXPECT_EQ(std::string_view(observer.last_ended_label), "Alice");
  EXPECT_EQ(observer.last_checkout_reason, CheckoutReason::kOtherTag);
  EXPECT_EQ(observer.start_count, 2);
  EXPECT_EQ(std::string_view(observer.last_started_label), "Bob");
}

TEST(SessionFsmTest, TakeoverUiConfirmEndsOldStartsNew) {
  SessionFsm fsm;
  MockObserver observer;
  fsm.AddObserver(&observer);
  auto tag1 = MakeTagUid(std::byte{0x01});
  auto tag2 = MakeTagUid(std::byte{0x02});

  fsm.receive(MakeAuthEvent(tag1, "Alice"));
  fsm.receive(MakeAuthEvent(tag2, "Bob"));
  fsm.receive(session_event::UiConfirm{});

  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kRunning);
  EXPECT_EQ(observer.end_count, 1);
  EXPECT_EQ(observer.start_count, 2);
}

TEST(SessionFsmTest, TakeoverCancelReturnsToRunning) {
  SessionFsm fsm;
  MockObserver observer;
  fsm.AddObserver(&observer);
  auto tag1 = MakeTagUid(std::byte{0x01});
  auto tag2 = MakeTagUid(std::byte{0x02});

  fsm.receive(MakeAuthEvent(tag1, "Alice"));
  fsm.receive(MakeAuthEvent(tag2, "Bob"));
  fsm.receive(session_event::UiCancel{});

  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kRunning);
  EXPECT_EQ(observer.end_count, 0);  // Original session still active
}

TEST(SessionFsmTest, TakeoverTimeoutReturnsToRunning) {
  SessionFsm fsm;
  auto tag1 = MakeTagUid(std::byte{0x01});
  auto tag2 = MakeTagUid(std::byte{0x02});

  fsm.receive(MakeAuthEvent(tag1));
  fsm.receive(MakeAuthEvent(tag2));
  fsm.receive(session_event::Timeout{});

  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kRunning);
}

TEST(SessionFsmTest, TakeoverTagRemovedKeepsPending) {
  SessionFsm fsm;
  auto tag1 = MakeTagUid(std::byte{0x01});
  auto tag2 = MakeTagUid(std::byte{0x02});

  fsm.receive(MakeAuthEvent(tag1));
  fsm.receive(MakeAuthEvent(tag2));
  fsm.receive(session_event::TagPresence(false));

  // Tag removed during takeover keeps prompt open
  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kTakeoverPending);
}

// --- Hierarchy behavior ---

TEST(SessionFsmTest, ActiveOnEnterFiresOnceForSession) {
  SessionFsm fsm;
  MockObserver observer;
  fsm.AddObserver(&observer);
  auto tag = MakeTagUid(std::byte{0x01});

  fsm.receive(MakeAuthEvent(tag));
  EXPECT_EQ(observer.start_count, 1);

  // Transition within Active children should not re-fire on_enter
  fsm.receive(MakeAuthEvent(tag));  // → CheckoutPending
  EXPECT_EQ(observer.start_count, 1);

  fsm.receive(session_event::UiCancel{});  // → Running
  EXPECT_EQ(observer.start_count, 1);
}

TEST(SessionFsmTest, ActiveOnExitFiresOnceOnSessionEnd) {
  SessionFsm fsm;
  MockObserver observer;
  fsm.AddObserver(&observer);
  auto tag = MakeTagUid(std::byte{0x01});

  fsm.receive(MakeAuthEvent(tag));

  // Transition within Active children should not fire on_exit
  fsm.receive(MakeAuthEvent(tag));  // → CheckoutPending
  EXPECT_EQ(observer.end_count, 0);

  fsm.receive(session_event::UiCancel{});  // → Running
  EXPECT_EQ(observer.end_count, 0);

  // Now actually end the session
  fsm.receive(MakeAuthEvent(tag));
  fsm.receive(session_event::HoldConfirmed{});
  EXPECT_EQ(observer.end_count, 1);
}

// --- Snapshot during pending states ---

TEST(SessionFsmTest, SnapshotDuringCheckoutPending) {
  SessionFsm fsm;
  auto tag = MakeTagUid(std::byte{0x01});

  fsm.receive(MakeAuthEvent(tag, "Alice"));
  fsm.receive(MakeAuthEvent(tag));
  fsm.SyncSnapshot();

  SessionSnapshotUi snapshot;
  fsm.GetSnapshot(snapshot);
  EXPECT_EQ(snapshot.state, SessionStateUi::kCheckoutPending);
  EXPECT_EQ(std::string_view(snapshot.session_user_label), "Alice");
}

TEST(SessionFsmTest, SnapshotDuringTakeoverPending) {
  SessionFsm fsm;
  auto tag1 = MakeTagUid(std::byte{0x01});
  auto tag2 = MakeTagUid(std::byte{0x02});

  fsm.receive(MakeAuthEvent(tag1, "Alice"));
  fsm.receive(MakeAuthEvent(tag2, "Bob"));
  fsm.SyncSnapshot();

  SessionSnapshotUi snapshot;
  fsm.GetSnapshot(snapshot);
  EXPECT_EQ(snapshot.state, SessionStateUi::kTakeoverPending);
  EXPECT_EQ(std::string_view(snapshot.session_user_label), "Alice");
  EXPECT_EQ(std::string_view(snapshot.pending_user_label), "Bob");
}

// --- Multiple observers ---

TEST(SessionFsmTest, MultipleObserversNotified) {
  SessionFsm fsm;
  MockObserver observer1;
  MockObserver observer2;
  fsm.AddObserver(&observer1);
  fsm.AddObserver(&observer2);

  fsm.receive(MakeAuthEvent(MakeTagUid(std::byte{0x01})));

  EXPECT_EQ(observer1.start_count, 1);
  EXPECT_EQ(observer2.start_count, 1);
}

// --- Session after checkout (restart) ---

TEST(SessionFsmTest, NewSessionAfterCheckout) {
  SessionFsm fsm;
  MockObserver observer;
  fsm.AddObserver(&observer);
  auto tag1 = MakeTagUid(std::byte{0x01});
  auto tag2 = MakeTagUid(std::byte{0x02});

  // First session
  fsm.receive(MakeAuthEvent(tag1, "Alice"));
  fsm.receive(MakeAuthEvent(tag1));
  fsm.receive(session_event::HoldConfirmed{});
  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kNoSession);

  // New session with different user
  fsm.receive(MakeAuthEvent(tag2, "Bob"));
  EXPECT_EQ(fsm.get_state_id(), SessionStateId::kRunning);
  EXPECT_EQ(observer.start_count, 2);
  EXPECT_EQ(std::string_view(observer.last_started_label), "Bob");
}

// --- Tag presence accessors ---

TEST(SessionFsmTest, SetTagPresent) {
  SessionFsm fsm;

  EXPECT_FALSE(fsm.tag_present());

  fsm.SetTagPresent(true);
  EXPECT_TRUE(fsm.tag_present());

  fsm.SetTagPresent(false);
  EXPECT_FALSE(fsm.tag_present());
}

}  // namespace
}  // namespace maco::app_state
