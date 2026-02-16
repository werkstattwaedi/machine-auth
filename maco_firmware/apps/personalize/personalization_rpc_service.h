// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/apps/personalize/tag_prober.h"
#include "maco_pb/personalization_service.rpc.pb.h"

namespace maco::personalize {

/// RPC service for triggering tag personalization.
class PersonalizationRpcService final
    : public ::maco::pw_rpc::nanopb::PersonalizationService::Service<
          PersonalizationRpcService> {
 public:
  explicit PersonalizationRpcService(TagProber& tag_prober)
      : tag_prober_(tag_prober) {}

  pw::Status PersonalizeNextTag(
      const ::maco_PersonalizeNextTagRequest& request,
      ::maco_PersonalizeNextTagResponse& response);

 private:
  TagProber& tag_prober_;
};

}  // namespace maco::personalize
