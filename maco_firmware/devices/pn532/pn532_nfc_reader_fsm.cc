// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pn532/pn532_nfc_reader_fsm.h"

#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"

namespace maco::nfc {

//=============================================================================
// State: Idle
//=============================================================================

etl::fsm_state_id_t Pn532StateIdle::on_enter_state() {
  // Idle state does nothing
  return etl::ifsm_state::No_State_Change;
}

etl::fsm_state_id_t Pn532StateIdle::on_event(const MsgStart&) {
  get_fsm_context().reader->StartDetection();
  return Pn532StateId::kDetecting;
}

//=============================================================================
// State: Detecting
//=============================================================================

etl::fsm_state_id_t Pn532StateDetecting::on_event(const MsgTagDetected& msg) {
  get_fsm_context().reader->StartProbe(msg.info);
  return Pn532StateId::kProbing;
}

etl::fsm_state_id_t Pn532StateDetecting::on_event(const MsgTagNotFound&) {
  // No tag found, restart detection
  get_fsm_context().reader->StartDetection();
  return etl::ifsm_state::No_State_Change;  // Stay in Detecting
}

//=============================================================================
// State: Probing
//=============================================================================

etl::fsm_state_id_t Pn532StateProbing::on_event(const MsgProbeComplete& msg) {
  get_fsm_context().reader->OnTagProbed(msg.tag);
  get_fsm_context().reader->SendTagArrived();
  return Pn532StateId::kSendingEvent;
}

etl::fsm_state_id_t Pn532StateProbing::on_event(const MsgProbeFailed&) {
  // Probe failed, restart detection
  get_fsm_context().reader->StartDetection();
  return Pn532StateId::kDetecting;
}

//=============================================================================
// State: SendingEvent
//=============================================================================

etl::fsm_state_id_t Pn532StateSendingEvent::on_event(const MsgEventSent&) {
  get_fsm_context().reader->SchedulePresenceCheck();
  return Pn532StateId::kTagPresent;
}

//=============================================================================
// State: TagPresent
//=============================================================================

etl::fsm_state_id_t Pn532StateTagPresent::on_event(const MsgAppRequest& msg) {
  get_fsm_context().reader->StartOperation(msg.request);
  return Pn532StateId::kExecutingOp;
}

etl::fsm_state_id_t Pn532StateTagPresent::on_event(const MsgPresenceCheckDue&) {
  get_fsm_context().reader->StartPresenceCheck();
  return Pn532StateId::kCheckingPresence;
}

//=============================================================================
// State: CheckingPresence
//=============================================================================

etl::fsm_state_id_t Pn532StateCheckingPresence::on_event(const MsgTagPresent&) {
  get_fsm_context().reader->SchedulePresenceCheck();
  return Pn532StateId::kTagPresent;
}

etl::fsm_state_id_t Pn532StateCheckingPresence::on_event(const MsgTagGone&) {
  get_fsm_context().reader->OnTagRemoved();
  get_fsm_context().reader->SendTagDeparted();
  // Go directly to detecting instead of through kSendingEvent→kTagPresent
  // since the tag is gone and we should restart detection.
  // Note: SendTagDeparted sets event_sent_pending_ which will be handled
  // by DoPend in kDetecting state, but we ignore it since we're detecting.
  get_fsm_context().reader->StartDetection();
  return Pn532StateId::kDetecting;
}

//=============================================================================
// State: ExecutingOp
//=============================================================================

etl::fsm_state_id_t Pn532StateExecutingOp::on_event(const MsgOpComplete& msg) {
  get_fsm_context().reader->OnOperationComplete(msg.result);
  get_fsm_context().reader->SchedulePresenceCheck();
  return Pn532StateId::kTagPresent;
}

etl::fsm_state_id_t Pn532StateExecutingOp::on_event(const MsgOpFailed&) {
  get_fsm_context().reader->OnOperationFailed();
  get_fsm_context().reader->HandleDesync();
  get_fsm_context().reader->StartDetection();
  return Pn532StateId::kDetecting;
}

}  // namespace maco::nfc
