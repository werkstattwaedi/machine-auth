// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>

#include "etl/hfsm.h"
#include "maco_firmware/modules/app_state/session_events.h"
#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/types.h"
#include "pw_assert/check.h"
#include "pw_chrono/system_clock.h"
#include "pw_string/string.h"
#include "pw_sync/lock_annotations.h"
#include "pw_sync/mutex.h"

namespace maco::app_state {

// --- State IDs ---

struct SessionStateId {
  enum enum_type : etl::fsm_state_id_t {
    kNoSession = 0,
    kActive = 1,        // Parent state
    kRunning = 2,       // Default child of Active
    kCheckoutPending = 3,
    kTakeoverPending = 4,
    kNumberOfStates = 5,
  };
};

// --- Checkout reason (for usage logging) ---

enum class CheckoutReason {
  kNone = 0,
  kSelfCheckout = 1,  // Same tag re-tapped and confirmed
  kOtherTag = 2,      // Different tag took over
  kUiCheckout = 3,    // UI button
  kTimeout = 4,       // Session timeout (future)
};

// --- Session data ---

struct SessionInfo {
  maco::TagUid tag_uid = maco::TagUid::FromArray({});
  maco::FirebaseId user_id = maco::FirebaseId::Empty();
  pw::InlineString<64> user_label;
  maco::FirebaseId auth_id = maco::FirebaseId::Empty();
  pw::chrono::SystemClock::time_point started_at;
};

// --- Usage record produced on session end ---

struct MachineUsage {
  maco::FirebaseId user_id = maco::FirebaseId::Empty();
  maco::FirebaseId auth_id = maco::FirebaseId::Empty();
  pw::chrono::SystemClock::time_point check_in;
  pw::chrono::SystemClock::time_point check_out;
  CheckoutReason reason = CheckoutReason::kNone;
};

// --- Observer interface ---

class SessionObserver {
 public:
  virtual ~SessionObserver() = default;
  virtual void OnSessionStarted(const SessionInfo& session) = 0;
  virtual void OnSessionEnded(const SessionInfo& session,
                              const MachineUsage& usage) = 0;
};

// --- FSM ID ---

inline constexpr etl::message_router_id_t kSessionFsmId = 0;

// --- Confirmation timeout ---

inline constexpr auto kConfirmationTimeout = std::chrono::seconds(15);
inline constexpr auto kHoldDuration = std::chrono::seconds(5);

// --- Forward declaration of FSM context ---

class SessionFsm;

// --- State Classes (defined before SessionFsm so they can be members) ---

/// Root state: no session active. Relay OFF.
class NoSession
    : public etl::fsm_state<SessionFsm, NoSession, SessionStateId::kNoSession,
                            session_event::UserAuthorized> {
 public:
  etl::fsm_state_id_t on_enter_state();
  etl::fsm_state_id_t on_event(const session_event::UserAuthorized& e);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return No_State_Change;
  }
};

/// Parent state: session active. Relay ON.
/// on_enter_state fires once when entering any child.
/// on_exit_state fires once when leaving to NoSession.
class Active
    : public etl::fsm_state<SessionFsm, Active, SessionStateId::kActive,
                            session_event::UserAuthorized> {
 public:
  etl::fsm_state_id_t on_enter_state();
  void on_exit_state();
  etl::fsm_state_id_t on_event(const session_event::UserAuthorized& e);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return No_State_Change;
  }
};

/// Default child of Active: normal running session.
class Running
    : public etl::fsm_state<SessionFsm, Running, SessionStateId::kRunning,
                            session_event::UserAuthorized> {
 public:
  etl::fsm_state_id_t on_event(const session_event::UserAuthorized&);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return No_State_Change;
  }
};

/// Child of Active: owner re-tapped, awaiting checkout confirmation.
class CheckoutPending
    : public etl::fsm_state<SessionFsm, CheckoutPending,
                            SessionStateId::kCheckoutPending,
                            session_event::HoldConfirmed,
                            session_event::UiConfirm, session_event::UiCancel,
                            session_event::TagPresence,
                            session_event::Timeout> {
 public:
  etl::fsm_state_id_t on_event(const session_event::HoldConfirmed&);
  etl::fsm_state_id_t on_event(const session_event::UiConfirm&);
  etl::fsm_state_id_t on_event(const session_event::UiCancel&);
  etl::fsm_state_id_t on_event(const session_event::TagPresence& e);
  etl::fsm_state_id_t on_event(const session_event::Timeout&);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return No_State_Change;
  }
};

/// Child of Active: different user tapped, awaiting takeover confirmation.
class TakeoverPending
    : public etl::fsm_state<SessionFsm, TakeoverPending,
                            SessionStateId::kTakeoverPending,
                            session_event::HoldConfirmed,
                            session_event::UiConfirm, session_event::UiCancel,
                            session_event::TagPresence,
                            session_event::Timeout> {
 public:
  etl::fsm_state_id_t on_event(const session_event::HoldConfirmed&);
  etl::fsm_state_id_t on_event(const session_event::UiConfirm&);
  etl::fsm_state_id_t on_event(const session_event::UiCancel&);
  etl::fsm_state_id_t on_event(const session_event::TagPresence&);
  etl::fsm_state_id_t on_event(const session_event::Timeout&);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return No_State_Change;
  }

 private:
  etl::fsm_state_id_t ConfirmTakeover();
};

// --- SessionFsm ---
//
// Threading model:
//   All FSM state transitions (receive()) happen on the main dispatcher thread.
//   State classes access context fields directly via get_fsm_context().
//
//   The UI thread reads session state via GetSnapshot(), which returns a
//   cached copy protected by snapshot_mutex_. The cached copy is updated
//   by SyncSnapshot(), which must be called after any state-mutating
//   operation (receive(), SetTagPresent()).

class SessionFsm : public etl::hfsm {
 public:
  SessionFsm();

  // --- Session data (main thread only, via get_fsm_context()) ---
  SessionInfo active_session;
  SessionInfo pending_session;  // For takeover: the new user
  CheckoutReason checkout_reason = CheckoutReason::kNone;

  // Timestamps for confirmation/hold tracking (main thread only)
  pw::chrono::SystemClock::time_point pending_since;
  pw::chrono::SystemClock::time_point pending_deadline;

  // Flag for chained takeover transition (main thread only)
  bool has_pending_takeover = false;

  // --- Tag presence (main thread only, use accessors) ---
  void SetTagPresent(bool present);
  bool tag_present() const { return tag_present_; }
  pw::chrono::SystemClock::time_point tag_present_since() const {
    return tag_present_since_;
  }

  // --- Observer management ---
  void AddObserver(SessionObserver* observer);
  void NotifySessionStarted(const SessionInfo& session);
  void NotifySessionEnded(const SessionInfo& session,
                          const MachineUsage& usage);

  // --- Snapshot (thread-safe for UI reads) ---
  void GetSnapshot(SessionSnapshotUi& out) const
      PW_LOCKS_EXCLUDED(snapshot_mutex_);

  /// Propagate current FSM state to the thread-safe snapshot.
  /// Must be called after receive() or SetTagPresent().
  void SyncSnapshot() PW_LOCKS_EXCLUDED(snapshot_mutex_);

 private:
  static constexpr size_t kMaxObservers = 4;
  std::array<SessionObserver*, kMaxObservers> observers_{};
  size_t observer_count_ = 0;

  // Tag presence (main thread only, not guarded - read via snapshot)
  bool tag_present_ = false;
  pw::chrono::SystemClock::time_point tag_present_since_;

  // State instances
  NoSession no_session_;
  Active active_;
  Running running_;
  CheckoutPending checkout_pending_;
  TakeoverPending takeover_pending_;

  // State list for ETL FSM
  etl::ifsm_state* state_list_[SessionStateId::kNumberOfStates];

  // Child state list for Active parent
  etl::ifsm_state* active_children_[3];

  mutable pw::sync::Mutex snapshot_mutex_;
  SessionSnapshotUi snapshot_ PW_GUARDED_BY(snapshot_mutex_);
};

}  // namespace maco::app_state
