#pragma once

#include <map>
#include <type_traits>

#include "Base64RK.h"
#include "cloud_response.h"
#include "common.h"
#include "flatbuffers/flatbuffers.h"
namespace oww::state {

class CloudRequest {
 public:
  /**
   * @brief Sends a request to the cloud and waits for a response.
   * This method is templated on the specific Request and Response types.
   *
   * @tparam TRequest The specific flatbuffers type of the request payload.
   * @tparam TResponse The specific flatbuffers type expected in the response.
   * @param command The specific command or endpoint identifier for the request.
   * @param payload The request data payload.
   * @param timeout_ms Maximum time to wait for the response in milliseconds.
   * @return std::shared_ptr<CloudResponse<TResponse>> A shared pointer to the
   * response object, which will be populated asynchronously upon success of
   * failure of the request.
   */
  template <typename TRequest, typename TResponse>
  std::shared_ptr<CloudResponse<TResponse>> SendTerminalRequest(
      String command, const TRequest& payload,
      system_tick_t timeout_ms = CONCURRENT_WAIT_FOREVER);

 private:
  struct InFlightRequest {
    std::function<void(uint8_t* data, size_t size)> response_handler;
    std::function<void(ErrorType error)> failure_handler;
    system_tick_t deadline = CONCURRENT_WAIT_FOREVER;
  };

  // Counter to generate unique request IDs.
  int request_counter_ = 1;
  // Requests currently awaiting a response.
  std::map<String, InFlightRequest> inflight_requests_;

  int HandleTerminalResponse(String response_payload);
  void HandleTerminalFailure(String request_id, particle::Error error);

  static Logger logger;

 protected:
  void Begin();
  void CheckTimeouts();
};

template <typename TRequest, typename TResponse>
std::shared_ptr<CloudResponse<TResponse>> CloudRequest::SendTerminalRequest(
    String command, const TRequest& payload, system_tick_t timeout_ms) {
  static_assert(
      std::is_class<TRequest>::value &&
          std::is_base_of<::flatbuffers::NativeTable, TRequest>::value,
      "Type TRequest must be flatbuffer obj type");
  using TRequestTable = typename TRequest::TableType;

  static_assert(
      std::is_class<TResponse>::value &&
          std::is_base_of<::flatbuffers::NativeTable, TResponse>::value,
      "Type TResponse must be flatbuffer obj type");
  using TResponseTable = typename TResponse::TableType;

  // Calculate absolute deadline time if timeout is provided
  system_tick_t deadline_ticks = (timeout_ms == CONCURRENT_WAIT_FOREVER)
                                     ? CONCURRENT_WAIT_FOREVER
                                     : (millis() + timeout_ms);

  // Create the response container specific to this request's TResponse type
  auto response_container =
      std::make_shared<CloudResponse<TResponse>>(Pending{});

  String request_id = String::format("req-%d", request_counter_++);

  InFlightRequest pending_request = {
      .response_handler =
          [response_container](const uint8_t* data, size_t size) {
            TResponse deserialized_response;
            auto verifier = flatbuffers::Verifier(data, size);

            if (verifier.VerifyBuffer<TResponseTable>()) {
              ::flatbuffers::GetRoot<TResponseTable>(data)->UnPackTo(
                  &deserialized_response);
              response_container->template emplace<TResponse>(
                  deserialized_response);
            } else {
              response_container->template emplace<ErrorType>(
                  ErrorType::kMalformedResponse);
            }
          },
      .failure_handler =
          [response_container](ErrorType error) {
            response_container->template emplace<ErrorType>(error);
          },
      .deadline = deadline_ticks,
  };

  inflight_requests_.emplace(request_id, std::move(pending_request));

  flatbuffers::FlatBufferBuilder builder(400);
  auto payload_length = TRequestTable::Pack(builder, &payload);
  builder.Finish(payload_length);

  auto base64_encoded_data =
      Base64::encodeToString(builder.GetBufferPointer(), builder.GetSize());

  String publish_payload =
      String::format("%s,%s,%s", command, request_id, base64_encoded_data);

  auto publish_future =
      Particle.publish("terminalRequest", publish_payload, WITH_ACK);

  publish_future.onError([this, request_id](particle::Error error) {
    // Call HandleTerminalFailure using the captured 'this' pointer and
    // request_id This will find the stored failure handler and invoke it.
    HandleTerminalFailure(request_id, error);
  });

  return response_container;  // Return the shared_ptr to the response struct
}
}  // namespace oww::state