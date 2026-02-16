// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/apps/personalize/personalize_coordinator.h"
#include "maco_pb/personalization_service.rpc.pb.h"

namespace maco::personalize {

/// RPC service for triggering tag personalization.
class PersonalizationRpcService final
    : public ::maco::pw_rpc::nanopb::PersonalizationService::Service<
          PersonalizationRpcService> {
 public:
  explicit PersonalizationRpcService(PersonalizeCoordinator& coordinator)
      : coordinator_(coordinator) {}

  pw::Status PersonalizeNextTag(
      const ::maco_PersonalizeNextTagRequest& request,
      ::maco_PersonalizeNextTagResponse& response);

 private:
  PersonalizeCoordinator& coordinator_;
};

}  // namespace maco::personalize
