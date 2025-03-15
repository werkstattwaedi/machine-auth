
#include "state.h"

#include "common/hex_util.h"
#include "state_request.h"

namespace oww::state {
using namespace oww::nfc::action;

Logger State::logger(oww::state::configuration::logtag);

Status State::Begin(std::unique_ptr<Configuration> configuration) {
  os_mutex_create(&mutex_);

  configuration_ = std::move(configuration);
  configuration_->Begin();

  tag_state_ = std::make_shared<tag::State>(tag::Idle{});

  CloudRequest::Begin();

  return Status::kOk;
}

void State::Loop() {
  if (auto state = std::get_if<tag::Authorize>(tag_state_.get())) {
    AuthorizationLoop(*state);
  } else if (auto state = std::get_if<tag::Personalize>(tag_state_.get())) {
    PersonalizationLoop(*state);
  }
}

void State::AuthorizationLoop(tag::Authorize& authorize_state) {}
bool State::AuthorizationResponse(RequestId requestId, Variant payload) {}

std::optional<tag::Personalize> State::PersonalizationLoop(
    tag::Personalize personalize_state) {
  auto nested_state = personalize_state.state;
  if (auto wait_state =
          std::get_if<tag::personalize::Wait>(nested_state.get())) {
    if (millis() > wait_state->timeout) {
      Variant payload;
      auto hex_uid_string = BytesToHexString(personalize_state.tag_uid);
      payload.set("uid", Variant(String(hex_uid_string.c_str())));
      if (auto request_result =
              SendTerminalRequest("presonalization", payload)) {
        auto result = personalize_state;
        result.state = std::make_shared<tag::personalize::State>(
            tag::personalize::RequestedKeys{.request_id =
                                                request_result.value()});

        return result;
      } else {
        // TODO: limit retry
        logger.error("failed to send personalization request");
      }
    }
  }

  return {};
}

tl::expected<tag::Personalize, ErrorType> State::PersonalizationResponse(
    RequestId requestId, Variant payload) {
  auto state = std::get_if<tag::Personalize>(tag_state_.get());
  if (!state) return tl::unexpected(ErrorType::kWrongState);

  auto requested_state =
      std::get_if<tag::personalize::RequestedKeys>(state->state.get());
  if (!requested_state || requested_state->request_id != requestId) {
    return tl::unexpected(ErrorType::kWrongState);
  }

  auto application_key = HexStringToBytes<16>(payload.get("application"));
  if (!application_key) return tl::unexpected(ErrorType::kMalformedResponse);
  auto authorization_key = HexStringToBytes<16>(payload.get("authorization"));
  if (!authorization_key) return tl::unexpected(ErrorType::kMalformedResponse);
  auto reserved1_key = HexStringToBytes<16>(payload.get("reserved1"));
  if (!reserved1_key) return tl::unexpected(ErrorType::kMalformedResponse);
  auto reserved2_key = HexStringToBytes<16>(payload.get("reserved2"));
  if (!reserved2_key) return tl::unexpected(ErrorType::kMalformedResponse);

  return {tag::Personalize{
      .tag_uid = state->tag_uid,
      .state =
          std::make_shared<tag::personalize::State>(tag::personalize::UpdateTag{
              .application_key = application_key.value(),
              .terminal_key = configuration_->GetTerminalKey(),
              .card_key = authorization_key.value(),
              .reserved_1_key = reserved1_key.value(),
              .reserved_2_key = reserved2_key.value(),

          })}};
}

void State::OnConfigChanged() { System.reset(RESET_REASON_CONFIG_UPDATE); }

void State::OnTagFound() {
  tag_state_ = std::make_shared<tag::State>(tag::Detected{});
}

void State::OnBlankNtag(std::array<std::byte, 7> uid) {
  tag_state_ = std::make_shared<tag::State>(tag::Personalize{
      .tag_uid = uid,
      .state = std::make_shared<tag::personalize::State>(tag::personalize::Wait{
          .timeout = millis() + 3000,
      })});
}

void State::OnTagAuthenicated(std::array<std::byte, 7> uid) {
  tag_state_ = std::make_shared<tag::State>(tag::Authenticated{.tag_uid = uid});
}

void State::OnUnknownTag() {
  tag_state_ = std::make_shared<tag::State>(tag::Unknown{});
}

void State::OnTagRemoved() {
  tag_state_ = std::make_shared<tag::State>(tag::Idle{});
}

}  // namespace oww::state
