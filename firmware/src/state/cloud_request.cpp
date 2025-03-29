#include "cloud_request.h"

namespace oww::state {

void CloudRequest::Begin() {
  Particle.function("TerminalResponse", &CloudRequest::HandleTerminalResponse,
                    this);
}

std::shared_ptr<CloudResponse> CloudRequest::SendTerminalRequest(
    String command, Variant& payload, system_tick_t timeout_ms) {
  auto deadline = timeout_ms;
  if (deadline != CONCURRENT_WAIT_FOREVER) deadline += millis();

  auto response_container =
      std::make_shared<CloudResponse>(CloudResponse{.deadline = deadline});
  auto requestId = String(request_counter_++);

  inflight_requests_[requestId] = response_container;

  payload.set("type", Variant(command));
  payload.set("requestId", Variant(requestId));

  auto publish_future = Particle.publish("terminalRequest", payload, WITH_ACK);
  publish_future.onError([this, requestId](auto error) {
    HandleTerminalFailure(requestId, error);
  });

  return response_container;
}

int CloudRequest::HandleTerminalResponse(String response_payload) {
  auto payload = Variant::fromJSON(response_payload).asMap();

  auto type = payload.get("type").asString();
  auto requestId = payload.get("requestId").asString();

  auto extracted = inflight_requests_.extract(requestId);
  if (extracted.empty()) {
    Log.error("HandleTerminalResponse(%s:%s) not found", type.c_str(),
              requestId.c_str());

    return -1;
  }

  extracted.mapped()->result = payload;
  return 0;
}

void CloudRequest::HandleTerminalFailure(String request_id,
                                         particle::Error error) {
  Log.error("HandleTerminalFailure(%s, %s)", request_id.c_str(),
            error.message());

  auto extracted = inflight_requests_.extract(request_id);
  if (extracted.empty()) return;

  extracted.mapped()->result = tl::unexpected(ErrorType::kUnspecified);
}

}  // namespace oww::state