#include "cloud_request.h"

namespace oww::state {

void CloudRequest::Begin() {
  Particle.function("TerminalResponse", &CloudRequest::HandleTerminalResponse,
                    this);
}

tl::expected<RequestId, ErrorType> CloudRequest::SendTerminalRequest(
    String command, Variant& payload) {
  payload.set("type", Variant(command));
  auto requestId = RequestId{request_counter_++};
  payload.set("requestId", Variant(static_cast<int>(requestId)));

  if (!Particle.publish("terminalRequest", payload, WITH_ACK)) {
    return tl::unexpected(ErrorType::kUnspecified);
  }

  return {requestId};
}

int CloudRequest::HandleTerminalResponse(String response_payload) {
  auto payload = Variant::fromJSON(response_payload).asMap();

  auto type = payload.get("type").asString();
  auto requestId = RequestId{payload.get("requestId").asInt()};

  DispatchTerminalResponse(type, requestId, payload);

  return 0;
}

}  // namespace oww::state