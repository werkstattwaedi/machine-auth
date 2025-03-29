#pragma once

#include <map>
#include <type_traits>

#include "../common.h"

namespace oww::state {

struct CloudResponse {
  const system_tick_t deadline = CONCURRENT_WAIT_FOREVER;
  std::optional<tl::expected<VariantMap, ErrorType>> result;
};

class CloudRequest {
 public:
  std::shared_ptr<CloudResponse> SendTerminalRequest(
      String command, Variant& payload,
      system_tick_t timeout_ms = CONCURRENT_WAIT_FOREVER);

 private:
  int request_counter_ = 1;
  std::map<String, std::shared_ptr<CloudResponse>> inflight_requests_;

  int HandleTerminalResponse(String response_payload);
  void HandleTerminalFailure(String request_id, particle::Error error);

 protected:
  void Begin();
};

}  // namespace oww::state