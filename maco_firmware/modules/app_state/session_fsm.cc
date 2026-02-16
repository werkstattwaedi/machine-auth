// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "SESS"

#include "maco_firmware/modules/app_state/session_fsm.h"

#include "pw_log/log.h"

namespace maco::app_state {

// --- SessionFsm ---

SessionFsm::SessionFsm() : etl::hfsm(kSessionFsmId) {
  // Set up state list (order must match SessionStateId values)
  state_list_[SessionStateId::kNoSession] = &no_session_;
  state_list_[SessionStateId::kActive] = &active_;
  state_list_[SessionStateId::kRunning] = &running_;
  state_list_[SessionStateId::kCheckoutPending] = &checkout_pending_;
  state_list_[SessionStateId::kTakeoverPending] = &takeover_pending_;

  // Set up hierarchy: Active is parent of Running, CheckoutPending,
  // TakeoverPending. First child added becomes the default child.
  active_children_[0] = &running_;
  active_children_[1] = &checkout_pending_;
  active_children_[2] = &takeover_pending_;
  active_.set_child_states(active_children_, 3);

  set_states(state_list_, SessionStateId::kNumberOfStates);
  start();
}

void SessionFsm::AddObserver(SessionObserver* observer) {
  PW_CHECK(observer_count_ < kMaxObservers,
           "Too many session observers (max %u)",
           static_cast<unsigned>(kMaxObservers));
  observers_[observer_count_++] = observer;
}

void SessionFsm::NotifySessionStarted(const SessionInfo& session) {
  for (size_t i = 0; i < observer_count_; ++i) {
    observers_[i]->OnSessionStarted(session);
  }
}

void SessionFsm::NotifySessionEnded(const SessionInfo& session,
                                     const MachineUsage& usage) {
  for (size_t i = 0; i < observer_count_; ++i) {
    observers_[i]->OnSessionEnded(session, usage);
  }
}

// --- TagVerifierObserver overrides ---

void SessionFsm::OnTagDetected(pw::ConstByteSpan /*uid*/) {
  SetTagPresent(true);
  receive(session_event::TagPresence(true));
  SyncSnapshot();
}

void SessionFsm::OnTagRemoved() {
  SetTagPresent(false);
  receive(session_event::TagPresence(false));
  SyncSnapshot();
}

void SessionFsm::OnAuthorized(const maco::TagUid& tag_uid,
                               const maco::FirebaseId& user_id,
                               const pw::InlineString<64>& user_label,
                               const maco::FirebaseId& auth_id) {
  receive(session_event::UserAuthorized(tag_uid, user_id, user_label, auth_id));
  SyncSnapshot();
}

void SessionFsm::SetTagPresent(bool present) {
  tag_present_ = present;
  if (present) {
    tag_present_since_ = pw::chrono::SystemClock::now();
  }
}

namespace {
SessionStateUi MapStateId(etl::fsm_state_id_t id) {
  switch (id) {
    case SessionStateId::kRunning:
      return SessionStateUi::kRunning;
    case SessionStateId::kCheckoutPending:
      return SessionStateUi::kCheckoutPending;
    case SessionStateId::kTakeoverPending:
      return SessionStateUi::kTakeoverPending;
    default:
      return SessionStateUi::kNoSession;
  }
}
}  // namespace

void SessionFsm::SyncSnapshot() {
  std::lock_guard lock(snapshot_mutex_);
  snapshot_.state = MapStateId(get_state_id());
  snapshot_.session_user_label = active_session.user_label;
  snapshot_.pending_user_label = pending_session.user_label;
  snapshot_.pending_since = pending_since;
  snapshot_.pending_deadline = pending_deadline;
  snapshot_.tag_present_since = tag_present_since_;
  snapshot_.tag_present = tag_present_;
}

void SessionFsm::GetSnapshot(SessionSnapshotUi& out) const {
  std::lock_guard lock(snapshot_mutex_);
  out = snapshot_;
}

// --- NoSession ---

etl::fsm_state_id_t NoSession::on_enter_state() {
  auto& ctx = get_fsm_context();

  // Check for chained takeover transition
  if (ctx.has_pending_takeover) {
    ctx.has_pending_takeover = false;
    ctx.active_session = ctx.pending_session;
    ctx.pending_session = SessionInfo{};
    PW_LOG_INFO("Takeover: starting session for %s",
                ctx.active_session.user_label.c_str());
    return SessionStateId::kRunning;
  }

  // Normal entry - clear session data
  ctx.active_session = SessionInfo{};
  ctx.pending_session = SessionInfo{};
  ctx.checkout_reason = CheckoutReason::kNone;
  return No_State_Change;
}

etl::fsm_state_id_t NoSession::on_event(
    const session_event::UserAuthorized& e) {
  auto& ctx = get_fsm_context();
  ctx.active_session.tag_uid = e.tag_uid;
  ctx.active_session.user_id = e.user_id;
  ctx.active_session.user_label = e.user_label;
  ctx.active_session.auth_id = e.auth_id;
  ctx.active_session.started_at = pw::chrono::SystemClock::now();
  PW_LOG_INFO("Session started for %s", e.user_label.c_str());
  return SessionStateId::kRunning;
}

// --- Active ---

etl::fsm_state_id_t Active::on_enter_state() {
  auto& ctx = get_fsm_context();
  ctx.NotifySessionStarted(ctx.active_session);
  PW_LOG_INFO("Active: relay ON");
  return No_State_Change;
}

void Active::on_exit_state() {
  auto& ctx = get_fsm_context();
  MachineUsage usage;
  usage.user_id = ctx.active_session.user_id;
  usage.auth_id = ctx.active_session.auth_id;
  usage.check_in = ctx.active_session.started_at;
  usage.check_out = pw::chrono::SystemClock::now();
  usage.reason = ctx.checkout_reason;
  ctx.NotifySessionEnded(ctx.active_session, usage);
  PW_LOG_INFO("Active: relay OFF");
}

etl::fsm_state_id_t Active::on_event(
    const session_event::UserAuthorized& e) {
  auto& ctx = get_fsm_context();
  auto now = pw::chrono::SystemClock::now();

  if (e.tag_uid == ctx.active_session.tag_uid) {
    // Same user re-tapped → checkout flow
    ctx.pending_since = now;
    ctx.pending_deadline = now + kConfirmationTimeout;
    ctx.checkout_reason = CheckoutReason::kSelfCheckout;
    PW_LOG_INFO("Same tag: checkout pending");
    return SessionStateId::kCheckoutPending;
  }

  // Different user → takeover flow
  ctx.pending_session.tag_uid = e.tag_uid;
  ctx.pending_session.user_id = e.user_id;
  ctx.pending_session.user_label = e.user_label;
  ctx.pending_session.auth_id = e.auth_id;
  ctx.pending_session.started_at = now;
  ctx.pending_since = now;
  ctx.pending_deadline = now + kConfirmationTimeout;
  PW_LOG_INFO("Different tag: takeover pending (%s)",
              e.user_label.c_str());
  return SessionStateId::kTakeoverPending;
}

// --- Running ---

etl::fsm_state_id_t Running::on_event(
    const session_event::UserAuthorized&) {
  // Bubble up to Active parent for same-user vs different-user logic
  return Pass_To_Parent;
}

// --- CheckoutPending ---

etl::fsm_state_id_t CheckoutPending::on_event(
    const session_event::HoldConfirmed&) {
  auto& ctx = get_fsm_context();
  ctx.checkout_reason = CheckoutReason::kSelfCheckout;
  PW_LOG_INFO("Checkout confirmed (hold)");
  return SessionStateId::kNoSession;
}

etl::fsm_state_id_t CheckoutPending::on_event(
    const session_event::UiConfirm&) {
  auto& ctx = get_fsm_context();
  ctx.checkout_reason = CheckoutReason::kUiCheckout;
  PW_LOG_INFO("Checkout confirmed (UI)");
  return SessionStateId::kNoSession;
}

etl::fsm_state_id_t CheckoutPending::on_event(
    const session_event::UiCancel&) {
  PW_LOG_INFO("Checkout cancelled");
  return SessionStateId::kRunning;
}

etl::fsm_state_id_t CheckoutPending::on_event(
    const session_event::TagPresence& e) {
  if (!e.present) {
    PW_LOG_INFO("Tag removed during checkout: back to running");
    return SessionStateId::kRunning;
  }
  return No_State_Change;
}

etl::fsm_state_id_t CheckoutPending::on_event(
    const session_event::Timeout&) {
  PW_LOG_INFO("Checkout timed out: back to running");
  return SessionStateId::kRunning;
}

// --- TakeoverPending ---

etl::fsm_state_id_t TakeoverPending::on_event(
    const session_event::HoldConfirmed&) {
  return ConfirmTakeover();
}

etl::fsm_state_id_t TakeoverPending::on_event(
    const session_event::UiConfirm&) {
  return ConfirmTakeover();
}

etl::fsm_state_id_t TakeoverPending::on_event(
    const session_event::UiCancel&) {
  PW_LOG_INFO("Takeover cancelled");
  return SessionStateId::kRunning;
}

etl::fsm_state_id_t TakeoverPending::on_event(
    const session_event::TagPresence&) {
  // Tag removed during takeover - keep prompt open (UI can still confirm)
  return No_State_Change;
}

etl::fsm_state_id_t TakeoverPending::on_event(
    const session_event::Timeout&) {
  PW_LOG_INFO("Takeover timed out: original session continues");
  return SessionStateId::kRunning;
}

etl::fsm_state_id_t TakeoverPending::ConfirmTakeover() {
  auto& ctx = get_fsm_context();
  ctx.checkout_reason = CheckoutReason::kOtherTag;
  ctx.has_pending_takeover = true;
  PW_LOG_INFO("Takeover confirmed: ending old session, starting new");
  // Transition to NoSession exits Active (fires OnSessionEnded),
  // then NoSession::on_enter_state chains into Running with new user.
  return SessionStateId::kNoSession;
}

}  // namespace maco::app_state
