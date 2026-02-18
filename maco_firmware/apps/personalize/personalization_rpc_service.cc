// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "P_RPC"

#include "maco_firmware/apps/personalize/personalization_rpc_service.h"

#include <cstring>

#include "pw_log/log.h"

namespace maco::personalize {

void PersonalizationRpcService::SubscribeTagEvents(
    const ::maco_SubscribeTagEventsRequest& request,
    ServerWriter<::maco_TagEvent>& writer) {
  (void)request;
  PW_LOG_INFO("SubscribeTagEvents: console connected");
  coordinator_.SetTagEventWriter(std::move(writer));
}

pw::Status PersonalizationRpcService::GetPersonalizeState(
    const ::maco_GetPersonalizeStateRequest& request,
    ::maco_GetPersonalizeStateResponse& response) {
  (void)request;

  PersonalizeSnapshot snapshot;
  coordinator_.GetSnapshot(snapshot);

  // Map internal state enum to proto enum
  using S = PersonalizeStateId;
  using P = maco_GetPersonalizeStateResponse_State;
  switch (snapshot.state) {
    case S::kIdle:
      response.state = P::maco_GetPersonalizeStateResponse_State_IDLE;
      break;
    case S::kProbing:
      response.state = P::maco_GetPersonalizeStateResponse_State_PROBING;
      break;
    case S::kFactoryTag:
      response.state = P::maco_GetPersonalizeStateResponse_State_FACTORY_TAG;
      break;
    case S::kMacoTag:
      response.state = P::maco_GetPersonalizeStateResponse_State_MACO_TAG;
      break;
    case S::kUnknownTag:
      response.state = P::maco_GetPersonalizeStateResponse_State_UNKNOWN_TAG;
      break;
    case S::kAwaitingTag:
      response.state =
          P::maco_GetPersonalizeStateResponse_State_AWAITING_KEYS;
      break;
    case S::kPersonalizing:
      response.state =
          P::maco_GetPersonalizeStateResponse_State_PERSONALIZING;
      break;
    case S::kPersonalized:
      response.state =
          P::maco_GetPersonalizeStateResponse_State_PERSONALIZED;
      break;
    case S::kError:
      response.state = P::maco_GetPersonalizeStateResponse_State_ERROR;
      break;
  }

  size_t uid_len = std::min(snapshot.uid_size, sizeof(response.uid.bytes));
  std::memcpy(response.uid.bytes, snapshot.uid.data(), uid_len);
  response.uid.size = uid_len;

  size_t msg_len = std::min(snapshot.error_message.size(),
                            sizeof(response.error_message) - 1);
  std::memcpy(
      response.error_message, snapshot.error_message.data(), msg_len);
  response.error_message[msg_len] = '\0';

  return pw::OkStatus();
}

pw::Status PersonalizationRpcService::PersonalizeTag(
    const ::maco_PersonalizeTagRequest& request,
    ::maco_PersonalizeTagResponse& response) {
  PW_LOG_INFO("PersonalizeTag RPC called");

  PersonalizationKeys keys;
  std::memcpy(keys.application_key.data(),
              request.application_key.bytes,
              sizeof(keys.application_key));
  std::memcpy(keys.terminal_key.data(),
              request.terminal_key.bytes,
              sizeof(keys.terminal_key));
  std::memcpy(keys.authorization_key.data(),
              request.authorization_key.bytes,
              sizeof(keys.authorization_key));
  std::memcpy(keys.sdm_mac_key.data(),
              request.sdm_mac_key.bytes,
              sizeof(keys.sdm_mac_key));
  std::memcpy(keys.reserved2_key.data(),
              request.reserved2_key.bytes,
              sizeof(keys.reserved2_key));

  coordinator_.DeliverKeys(keys);
  response.success = true;
  return pw::OkStatus();
}

}  // namespace maco::personalize
