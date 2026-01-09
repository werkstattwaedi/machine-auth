// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "etl/fsm.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader_events.h"

namespace maco::nfc {

// Forward declaration
template <typename Driver>
class NfcReader;

/// State IDs for the NfcReader FSM.
enum NfcReaderStateId : etl::fsm_state_id_t {
  kIdle = 0,
  kDetecting,
  kProbing,
  kSendingEvent,
  kTagPresent,
  kCheckingPresence,
  kExecutingOp,
  kNumberOfStates
};

// Forward declare state classes
template <typename Driver>
class StateIdle;
template <typename Driver>
class StateDetecting;
template <typename Driver>
class StateProbing;
template <typename Driver>
class StateSendingEvent;
template <typename Driver>
class StateTagPresent;
template <typename Driver>
class StateCheckingPresence;
template <typename Driver>
class StateExecutingOp;

/// The NfcReader FSM definition.
///
/// This FSM is owned by NfcReader and drives the tag detection,
/// presence checking, and application operation handling.
template <typename Driver>
class NfcReaderFsm : public etl::fsm {
 public:
  NfcReaderFsm() : etl::fsm(NfcReaderStateId::kNumberOfStates) {}

  NfcReader<Driver>* reader = nullptr;
};

//=============================================================================
// State: Idle - waiting to start detection
//=============================================================================
template <typename Driver>
class StateIdle : public etl::fsm_state<
                      NfcReaderFsm<Driver>,
                      StateIdle<Driver>,
                      NfcReaderStateId::kIdle,
                      MsgStart> {
 public:
  etl::fsm_state_id_t on_enter_state() {
    // Automatically start detection when entering idle
    this->get_fsm_context().reader->StartDetection();
    return NfcReaderStateId::kDetecting;
  }

  etl::fsm_state_id_t on_event(const MsgStart&) {
    // Explicit start (shouldn't normally be needed)
    this->get_fsm_context().reader->StartDetection();
    return NfcReaderStateId::kDetecting;
  }

  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: Detecting - waiting for DetectTag future
//=============================================================================
template <typename Driver>
class StateDetecting : public etl::fsm_state<
                           NfcReaderFsm<Driver>,
                           StateDetecting<Driver>,
                           NfcReaderStateId::kDetecting,
                           MsgTagDetected,
                           MsgTagNotFound> {
 public:
  etl::fsm_state_id_t on_event(const MsgTagDetected& msg) {
    this->get_fsm_context().reader->StartProbe(msg.info);
    return NfcReaderStateId::kProbing;
  }

  etl::fsm_state_id_t on_event(const MsgTagNotFound&) {
    // Go back to idle, will restart detection
    return NfcReaderStateId::kIdle;
  }

  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: Probing - identifying tag type via SELECT commands
//=============================================================================
template <typename Driver>
class StateProbing : public etl::fsm_state<
                         NfcReaderFsm<Driver>,
                         StateProbing<Driver>,
                         NfcReaderStateId::kProbing,
                         MsgProbeComplete,
                         MsgProbeFailed> {
 public:
  etl::fsm_state_id_t on_event(const MsgProbeComplete& msg) {
    this->get_fsm_context().reader->OnTagProbed(msg.tag);
    return NfcReaderStateId::kSendingEvent;
  }

  etl::fsm_state_id_t on_event(const MsgProbeFailed&) {
    // Probe failed, go back to idle
    return NfcReaderStateId::kIdle;
  }

  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: SendingEvent - waiting for channel Send future
//=============================================================================
template <typename Driver>
class StateSendingEvent : public etl::fsm_state<
                              NfcReaderFsm<Driver>,
                              StateSendingEvent<Driver>,
                              NfcReaderStateId::kSendingEvent,
                              MsgEventSent> {
 public:
  etl::fsm_state_id_t on_event(const MsgEventSent&) {
    auto* reader = this->get_fsm_context().reader;
    if (reader->HasTag()) {
      reader->SchedulePresenceCheck();
      return NfcReaderStateId::kTagPresent;
    } else {
      // Tag departed event was sent, go to idle
      return NfcReaderStateId::kIdle;
    }
  }

  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: TagPresent - tag is present, checking for requests or timer
//=============================================================================
template <typename Driver>
class StateTagPresent : public etl::fsm_state<
                            NfcReaderFsm<Driver>,
                            StateTagPresent<Driver>,
                            NfcReaderStateId::kTagPresent,
                            MsgAppRequest,
                            MsgPresenceCheckDue> {
 public:
  etl::fsm_state_id_t on_event(const MsgAppRequest& msg) {
    this->get_fsm_context().reader->StartOperation(msg.request);
    return NfcReaderStateId::kExecutingOp;
  }

  etl::fsm_state_id_t on_event(const MsgPresenceCheckDue&) {
    this->get_fsm_context().reader->StartPresenceCheck();
    return NfcReaderStateId::kCheckingPresence;
  }

  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: CheckingPresence - waiting for CheckPresent future
//=============================================================================
template <typename Driver>
class StateCheckingPresence : public etl::fsm_state<
                                  NfcReaderFsm<Driver>,
                                  StateCheckingPresence<Driver>,
                                  NfcReaderStateId::kCheckingPresence,
                                  MsgTagPresent,
                                  MsgTagGone> {
 public:
  etl::fsm_state_id_t on_event(const MsgTagPresent&) {
    this->get_fsm_context().reader->SchedulePresenceCheck();
    return NfcReaderStateId::kTagPresent;
  }

  etl::fsm_state_id_t on_event(const MsgTagGone&) {
    this->get_fsm_context().reader->OnTagRemoved();
    return NfcReaderStateId::kSendingEvent;
  }

  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: ExecutingOp - executing app-requested transceive operation
//=============================================================================
template <typename Driver>
class StateExecutingOp : public etl::fsm_state<
                             NfcReaderFsm<Driver>,
                             StateExecutingOp<Driver>,
                             NfcReaderStateId::kExecutingOp,
                             MsgOpComplete,
                             MsgOpFailed> {
 public:
  etl::fsm_state_id_t on_event(const MsgOpComplete& msg) {
    this->get_fsm_context().reader->OnOperationComplete(msg.result);
    this->get_fsm_context().reader->SchedulePresenceCheck();
    return NfcReaderStateId::kTagPresent;
  }

  etl::fsm_state_id_t on_event(const MsgOpFailed&) {
    // OnOperationFailed() calls OnTagRemoved() internally
    this->get_fsm_context().reader->OnOperationFailed();
    return NfcReaderStateId::kSendingEvent;
  }

  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

}  // namespace maco::nfc
