// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/apps/personalize/personalize_coordinator.h"
#include "maco_pb/personalization_service.rpc.pb.h"

namespace maco::personalize {

/// RPC service for console-driven tag personalization.
class PersonalizationRpcService final
    : public ::maco::pw_rpc::nanopb::PersonalizationService::Service<
          PersonalizationRpcService> {
 public:
  explicit PersonalizationRpcService(PersonalizeCoordinator& coordinator)
      : coordinator_(coordinator) {}

  void SubscribeTagEvents(
      const ::maco_SubscribeTagEventsRequest& request,
      ServerWriter<::maco_TagEvent>& writer);

  pw::Status GetPersonalizeState(
      const ::maco_GetPersonalizeStateRequest& request,
      ::maco_GetPersonalizeStateResponse& response);

  pw::Status PersonalizeTag(
      const ::maco_PersonalizeTagRequest& request,
      ::maco_PersonalizeTagResponse& response);

 private:
  PersonalizeCoordinator& coordinator_;
};

}  // namespace maco::personalize
