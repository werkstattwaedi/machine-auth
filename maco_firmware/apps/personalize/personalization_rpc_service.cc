// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "P_RPC"

#include "maco_firmware/apps/personalize/personalization_rpc_service.h"

#include "pw_log/log.h"

namespace maco::personalize {

pw::Status PersonalizationRpcService::PersonalizeNextTag(
    const ::maco_PersonalizeNextTagRequest& request,
    ::maco_PersonalizeNextTagResponse& response) {
  (void)request;
  PW_LOG_INFO("PersonalizeNextTag RPC called - arming");
  tag_prober_.RequestPersonalization();
  response.armed = true;
  return pw::OkStatus();
}

}  // namespace maco::personalize
