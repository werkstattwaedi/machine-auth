#include "cloud_request.h"

namespace oww::logic {

Logger CloudRequest::logger("cloud_request");

void CloudRequest::Begin() {
  SubscribeOptions subscribeOptions;
  subscribeOptions.structured(true);

  Particle.subscribe(
      System.deviceID() + "/hook-response/terminalRequest/",
      [this](CloudEvent event) { HandleTerminalResponse(event); },
      subscribeOptions);
}

void CloudRequest::HandleTerminalResponse(CloudEvent event) {
  EventData event_data = event.dataStructured();

  if (!event_data.has("id") || !event_data.has("data")) {
    logger.error("Invalid response, missing id or data property");
    return;
  }

  String request_id = event_data.get("id").asString();
  String response_data = event_data.get("data").asString();

  auto it = inflight_requests_.find(request_id);
  if (it == inflight_requests_.end()) {
    logger.error("Received response for unknown or timed-out request ID: %s",
                 request_id.c_str());
    return;
  }

  InFlightRequest& inflight_request = it->second;

  // Check for timeout before invoking handler (optional)
  if (inflight_request.deadline != CONCURRENT_WAIT_FOREVER &&
      millis() > inflight_request.deadline) {
    logger.warn("Received response for request %s after deadline.",
                request_id.c_str());
  }

  size_t decoded_len = Base64::getMaxDecodedSize(response_data.length());

  std::unique_ptr<uint8_t[]> decoded = std::make_unique<uint8_t[]>(decoded_len);

  if (!Base64::decode(response_data.c_str(), decoded.get(), decoded_len)) {
    logger.error("Unparsable TerminalResponse payload. Base64 decode failed.");
    return;
  }

  assert(inflight_request.response_handler);
  inflight_request.response_handler(decoded.get(), decoded_len);

  // Remove the processed request from the map
  inflight_requests_.erase(it);
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

void CloudRequest::Loop() {
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

}  // namespace oww::logic