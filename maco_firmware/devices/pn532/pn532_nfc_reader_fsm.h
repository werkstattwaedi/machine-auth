// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>

#include "etl/fsm.h"
#include "etl/message.h"
#include "maco_firmware/devices/pn532/tag_info.h"
#include "pw_result/result.h"

namespace maco::nfc {

// Forward declarations
class Pn532NfcReader;
class NfcTag;
struct TransceiveRequest;

/// Message IDs for Pn532NfcReader FSM events.
enum class Pn532MessageId : etl::message_id_t {
  kStart = 0,
  kTagDetected,
  kTagNotFound,
  kProbeComplete,
  kProbeFailed,
  kEventSent,
  kPresenceCheckDue,
  kTagPresent,
  kTagGone,
  kAppRequest,
  kOpComplete,
  kOpFailed,
};

/// State IDs for the Pn532NfcReader FSM.
enum Pn532StateId : etl::fsm_state_id_t {
  kIdle = 0,
  kDetecting,
  kProbing,
  kSendingEvent,
  kTagPresent,
  kCheckingPresence,
  kExecutingOp,
  kNumberOfStates
};

// Message definitions
struct MsgStart
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kStart)> {};

struct MsgTagDetected
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kTagDetected)> {
  explicit MsgTagDetected(const TagInfo& tag_info) : info(tag_info) {}
  TagInfo info;
};

struct MsgTagNotFound
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kTagNotFound)> {};

struct MsgProbeComplete
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kProbeComplete)> {
  explicit MsgProbeComplete(std::shared_ptr<NfcTag> t) : tag(std::move(t)) {}
  std::shared_ptr<NfcTag> tag;
};

struct MsgProbeFailed
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kProbeFailed)> {};

struct MsgEventSent
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kEventSent)> {};

struct MsgPresenceCheckDue
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kPresenceCheckDue)> {};

struct MsgTagPresent
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kTagPresent)> {};

struct MsgTagGone
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kTagGone)> {};

struct MsgAppRequest
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kAppRequest)> {
  explicit MsgAppRequest(TransceiveRequest* req) : request(req) {}
  TransceiveRequest* request;
};

struct MsgOpComplete
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kOpComplete)> {
  explicit MsgOpComplete(pw::Result<size_t> res) : result(std::move(res)) {}
  pw::Result<size_t> result;
};

struct MsgOpFailed
    : public etl::message<static_cast<etl::message_id_t>(Pn532MessageId::kOpFailed)> {};

/// The Pn532NfcReader FSM definition.
class Pn532NfcReaderFsm : public etl::fsm {
 public:
  Pn532NfcReaderFsm() : etl::fsm(Pn532StateId::kNumberOfStates) {}
  Pn532NfcReader* reader = nullptr;
};

// Forward declare state classes
class Pn532StateIdle;
class Pn532StateDetecting;
class Pn532StateProbing;
class Pn532StateSendingEvent;
class Pn532StateTagPresent;
class Pn532StateCheckingPresence;
class Pn532StateExecutingOp;

//=============================================================================
// State: Idle - waiting to start detection
//=============================================================================
class Pn532StateIdle : public etl::fsm_state<Pn532NfcReaderFsm, Pn532StateIdle,
                                              Pn532StateId::kIdle, MsgStart> {
 public:
  etl::fsm_state_id_t on_enter_state();
  etl::fsm_state_id_t on_event(const MsgStart&);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: Detecting - waiting for DetectTag future
//=============================================================================
class Pn532StateDetecting
    : public etl::fsm_state<Pn532NfcReaderFsm, Pn532StateDetecting,
                            Pn532StateId::kDetecting, MsgTagDetected,
                            MsgTagNotFound> {
 public:
  etl::fsm_state_id_t on_event(const MsgTagDetected& msg);
  etl::fsm_state_id_t on_event(const MsgTagNotFound&);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: Probing - identifying tag type via SELECT commands
//=============================================================================
class Pn532StateProbing
    : public etl::fsm_state<Pn532NfcReaderFsm, Pn532StateProbing,
                            Pn532StateId::kProbing, MsgProbeComplete,
                            MsgProbeFailed> {
 public:
  etl::fsm_state_id_t on_event(const MsgProbeComplete& msg);
  etl::fsm_state_id_t on_event(const MsgProbeFailed&);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: SendingEvent - sending event to application
//=============================================================================
class Pn532StateSendingEvent
    : public etl::fsm_state<Pn532NfcReaderFsm, Pn532StateSendingEvent,
                            Pn532StateId::kSendingEvent, MsgEventSent> {
 public:
  etl::fsm_state_id_t on_event(const MsgEventSent&);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: TagPresent - tag is present, checking for requests or timer
//=============================================================================
class Pn532StateTagPresent
    : public etl::fsm_state<Pn532NfcReaderFsm, Pn532StateTagPresent,
                            Pn532StateId::kTagPresent, MsgAppRequest,
                            MsgPresenceCheckDue> {
 public:
  etl::fsm_state_id_t on_event(const MsgAppRequest& msg);
  etl::fsm_state_id_t on_event(const MsgPresenceCheckDue&);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: CheckingPresence - waiting for CheckPresent future
//=============================================================================
class Pn532StateCheckingPresence
    : public etl::fsm_state<Pn532NfcReaderFsm, Pn532StateCheckingPresence,
                            Pn532StateId::kCheckingPresence, MsgTagPresent,
                            MsgTagGone> {
 public:
  etl::fsm_state_id_t on_event(const MsgTagPresent&);
  etl::fsm_state_id_t on_event(const MsgTagGone&);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

//=============================================================================
// State: ExecutingOp - executing app-requested transceive operation
//=============================================================================
class Pn532StateExecutingOp
    : public etl::fsm_state<Pn532NfcReaderFsm, Pn532StateExecutingOp,
                            Pn532StateId::kExecutingOp, MsgOpComplete,
                            MsgOpFailed> {
 public:
  etl::fsm_state_id_t on_event(const MsgOpComplete& msg);
  etl::fsm_state_id_t on_event(const MsgOpFailed&);
  etl::fsm_state_id_t on_event_unknown(const etl::imessage&) {
    return etl::ifsm_state::No_State_Change;
  }
};

}  // namespace maco::nfc
