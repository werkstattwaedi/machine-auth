#pragma once

#include "../common.h"

namespace oww::state {

enum class RequestId : int { kInvalid = 0 };

class CloudRequest {
 public:
  tl::expected<RequestId, ErrorType> SendTerminalRequest(String command,
                                                         Variant& payload);

 private:
  int request_counter_ = 1;
  int HandleTerminalResponse(String response_payload);

 protected:
  void Begin();
  virtual int DispatchTerminalResponse(String command, RequestId request_id,
                                       VariantMap& payload) = 0;
};

}  // namespace oww::state