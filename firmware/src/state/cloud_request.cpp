#include "cloud_request.h"

namespace oww::state {

Logger CloudRequest::logger("cloud_request");

void CloudRequest::Begin() {
  Particle.function("TerminalResponse", &CloudRequest::HandleTerminalResponse,
                    this);
}

// std::shared_ptr<CloudResponse> CloudRequest::SendTerminalRequest(
//     String command, Variant& payload, system_tick_t timeout_ms) {
//   auto deadline = timeout_ms;
//   if (deadline != CONCURRENT_WAIT_FOREVER) deadline += millis();

//   auto response_container =
//       std::make_shared<CloudResponse>(CloudResponse{.deadline = deadline});

//   auto requestId = String(request_counter_++);

//   inflight_requests_[requestId] = response_container;

//   payload.set("type", Variant(command));
//   payload.set("requestId", Variant(requestId));

//   auto publish_future = Particle.publish("terminalRequest", payload,
//   WITH_ACK); publish_future.onError([this, requestId](auto error) {
//     HandleTerminalFailure(requestId, error);
//   });

//   return response_container;
// }

int CloudRequest::HandleTerminalResponse(String response_payload) {
  auto id_end_index = response_payload.indexOf(',');
  if (id_end_index < 0) {
    logger.error(
        "Unparsable TerminalResponse payload. RequestID Separator not found.");
    return -1;
  }

  auto request_id = response_payload.substring(0, id_end_index);
  auto it = inflight_requests_.find(request_id);
  if (it == inflight_requests_.end()) {
    logger.error("Received response for unknown or timed-out request ID: %s",
                 request_id.c_str());
    return 0;
  }

  InFlightRequest& inflight_request = it->second;

  // Check for timeout before invoking handler (optional)
  if (inflight_request.deadline != CONCURRENT_WAIT_FOREVER &&
      millis() > inflight_request.deadline) {
    logger.warn("Received response for request %s after deadline.",
                request_id.c_str());
  }

  auto status_end_index = response_payload.indexOf(',', id_end_index + 1);
  if (status_end_index < 0) {
    if (response_payload.substring(id_end_index + 1) == "ERROR") {
      logger.error("Received error response for request %s",
                   request_id.c_str());
      inflight_request.failure_handler(ErrorType::kWrongState);
      return 0;
    } else {
      logger.error(
          "Unparsable TerminalResponse payload. Status Separator not found.");
      return -1;
    }
  }

  auto status = response_payload.substring(id_end_index + 1, status_end_index);
  if (status != "OK") {
    logger.error("Unparsable TerminalResponse payload. Unknown status: %s",
                 status.c_str());
    return -1;
  }

  auto encoded = response_payload.substring(status_end_index + 1);

  size_t decoded_len = Base64::getMaxDecodedSize(encoded.length());

  std::unique_ptr<uint8_t[]> decoded = std::make_unique<uint8_t[]>(decoded_len);

  if (!Base64::decode(encoded.c_str(), decoded.get(), decoded_len)) {
    logger.error("Unparsable TerminalResponse payload. Base64 decode failed.");
    return -3;
  }

  assert(inflight_request.response_handler);
  inflight_request.response_handler(decoded.get(), decoded_len);

  // Remove the processed request from the map
  inflight_requests_.erase(it);

  return 0;
}

void CloudRequest::HandleTerminalFailure(String request_id,
                                         particle::Error error) {
  auto it = inflight_requests_.find(request_id);
  if (it == inflight_requests_.end()) {
    logger.warn(
        "Received failure for unknown or already handled request ID: %s",
        request_id.c_str());
    return;
  }

  ErrorType internal_error = ErrorType::kUnspecified;
  switch (error.type()) {
    case particle::Error::TIMEOUT:
      internal_error = ErrorType::kTimeout;
      break;
  }

  InFlightRequest& inflight_request = it->second;
  assert(inflight_request.failure_handler);
  inflight_request.failure_handler(internal_error);
  inflight_requests_.erase(it);
}

void CloudRequest::CheckTimeouts() {
  system_tick_t now = millis();
  std::vector<String> timed_out_ids;

  for (auto const& [request_id, inflight_request] : inflight_requests_) {
    // Check if a deadline is set and if it has passed
    if (inflight_request.deadline != CONCURRENT_WAIT_FOREVER &&
        now > inflight_request.deadline) {
      logger.warn("Request %s timed out", request_id.c_str());
      timed_out_ids.push_back(request_id);  // Mark for removal and handling
    }
  }

  // Process and remove timed-out requests
  for (const auto& request_id : timed_out_ids) {
    auto it = inflight_requests_.find(request_id);
    assert(it != inflight_requests_.end());
    it->second.failure_handler(ErrorType::kTimeout);
    inflight_requests_.erase(it);  // Remove from the map
  }
}

}  // namespace oww::state