#include "logic/action/personalize.h"

#include <array>
#include <type_traits>

#include "common/byte_array.h"
#include "common/debug.h"
#include "config.h"
#include "logic/application.h"
#include "logic/configuration.h"
#include "nfc/driver/Ntag424.h"
#include "nfc/nfc_tags.h"

namespace oww::logic::action {

using namespace oww::logic::action::personalize;
using namespace oww::nfc;
using namespace fbs;
using namespace config::tag;

namespace {

std::array<uint8_t, 16> get_key_bytes(
    const std::unique_ptr<fbs::KeyBytes>& source) {
  std::array<uint8_t, 16> destination{};
  if (source && source->uid()) {
    std::copy(source->uid()->begin(), source->uid()->end(),
              destination.begin());
  }
  return destination;
}

tl::expected<std::array<uint8_t, 16>, Ntag424::DNA_StatusCode> ProbeKeys(
    Ntag424& ntag_interface, Ntag424Key key_no,
    std::vector<std::array<uint8_t, 16>> keys) {
  for (auto key : keys) {
    auto result = ntag_interface.Authenticate(key_no, key);
    if (result) return key;
  }

  return tl::unexpected(Ntag424::DNA_StatusCode::AUTHENTICATION_ERROR);
};

}  // namespace

tl::expected<std::shared_ptr<InternalState>, ErrorType> OnBegin(
    std::array<uint8_t, 7> tag_uid, CloudRequest& cloud_request) {
  KeyDiversificationRequestT request;
  request.token_id =
      std::make_unique<TagUid>(flatbuffers::span<uint8_t, 7>(tag_uid));

  auto response =
      cloud_request.SendTerminalRequest<KeyDiversificationRequestT,
                                        KeyDiversificationResponseT>(
          "personalize", request);

  return std::make_shared<InternalState>(
      AwaitKeyDiversificationResponse{.response = response});
}

tl::expected<std::shared_ptr<InternalState>, ErrorType>
OnAwaitKeyDiversificationResponse(
    AwaitKeyDiversificationResponse& response_holder,
    std::array<uint8_t, 16> terminal_key) {
  auto cloud_response = response_holder.response.get();
  if (IsPending(*cloud_response)) {
    return nullptr;
  }

  auto response = std::get_if<KeyDiversificationResponseT>(cloud_response);
  if (!response) {
    return tl::unexpected(std::get<ErrorType>(*cloud_response));
  }

  auto application_key = get_key_bytes(response->application_key);
  auto card_key = get_key_bytes(response->authorization_key);
  auto reserved_1_key = get_key_bytes(response->reserved1_key);
  auto reserved_2_key = get_key_bytes(response->reserved2_key);

  auto next_state = DoPersonalizeTag{
      .application_key = application_key,
      .terminal_key = terminal_key,
      .card_key = card_key,
      .reserved_1_key = reserved_1_key,
      .reserved_2_key = reserved_2_key,
  };

  return std::make_shared<InternalState>(next_state);
}

tl::expected<std::shared_ptr<InternalState>, ErrorType> OnDoPersonalizeTag(
    DoPersonalizeTag& update_tag, Ntag424& ntag_interface) {
  std::array<uint8_t, 16> factory_default_key = {};

  auto current_key_0 =
      ProbeKeys(ntag_interface, key_application,
                {factory_default_key, update_tag.application_key});
  if (!current_key_0) {
    return tl::unexpected(ErrorType::kNtagFailed);
  }

  auto current_key_1 =
      ProbeKeys(ntag_interface, key_terminal,
                {factory_default_key, update_tag.terminal_key});
  if (!current_key_1) {
    return tl::unexpected(ErrorType::kNtagFailed);
  }
  auto current_key_2 = ProbeKeys(ntag_interface, key_authorization,
                                 {factory_default_key, update_tag.card_key});
  if (!current_key_2) {
    return tl::unexpected(ErrorType::kNtagFailed);
  }

  auto current_key_3 =
      ProbeKeys(ntag_interface, key_reserved_1,
                {factory_default_key, update_tag.reserved_1_key});
  if (!current_key_3) {
    return tl::unexpected(ErrorType::kNtagFailed);
  }

  auto current_key_4 =
      ProbeKeys(ntag_interface, key_reserved_2,
                {factory_default_key, update_tag.reserved_2_key});
  if (!current_key_4) {
    return tl::unexpected(ErrorType::kNtagFailed);
  }

  if (auto result =
          ntag_interface.Authenticate(key_application, current_key_0.value());
      !result) {
    return tl::unexpected(ErrorType::kNtagFailed);
  }

  if (auto result = ntag_interface.ChangeKey(
          key_terminal, current_key_1.value(), update_tag.terminal_key,
          /* key_version */ 1);
      !result) {
    return tl::unexpected(ErrorType::kNtagFailed);
  }

  if (auto result =
          ntag_interface.ChangeKey(key_authorization, current_key_2.value(),
                                   update_tag.card_key, /* key_version */ 1);
      !result) {
    return tl::unexpected(ErrorType::kNtagFailed);
  }

  if (auto result = ntag_interface.ChangeKey(
          key_reserved_1, current_key_3.value(), update_tag.reserved_1_key,
          /* key_version */ 1);
      !result) {
    return tl::unexpected(ErrorType::kNtagFailed);
  }

  if (auto result = ntag_interface.ChangeKey(
          key_reserved_2, current_key_4.value(), update_tag.reserved_2_key,
          /* key_version */ 1);
      !result) {
    return tl::unexpected(ErrorType::kNtagFailed);
  }

  if (auto result = ntag_interface.ChangeKey0(
          update_tag.application_key, /* key_version */
          1);
      !result) {
    return tl::unexpected(ErrorType::kNtagFailed);
  }

  return std::make_shared<InternalState>(Completed{});
}

// ---- Loop dispatchers ------------------------------------------------------

PersonalizeAction::PersonalizeAction(
    std::array<uint8_t, 7> tag_uid, std::array<uint8_t, 16> terminal_key,
    std::weak_ptr<oww::logic::CloudRequest> cloud_request)
    : tag_uid_(tag_uid),
      terminal_key_(terminal_key),
      cloud_request_(cloud_request),
      state_(std::make_shared<InternalState>(Begin{})) {}

NtagAction::Continuation PersonalizeAction::Loop(Ntag424& ntag_interface) {
  auto cloud_request = cloud_request_.lock();

  tl::expected<std::shared_ptr<InternalState>, ErrorType> result;

  if (std::get_if<Begin>(state_.get())) {
    result = OnBegin(tag_uid_, *cloud_request);
  } else if (auto nested =
                 std::get_if<AwaitKeyDiversificationResponse>(state_.get())) {
    result = OnAwaitKeyDiversificationResponse(*nested, terminal_key_);
  } else if (auto nested = std::get_if<DoPersonalizeTag>(state_.get())) {
    result = OnDoPersonalizeTag(*nested, ntag_interface);
  }

  if (!result) {
    state_ = std::make_shared<InternalState>(Failed{.error = result.error()});
  } else if (auto new_state = (*result)) {
    state_ = new_state;
  }

  return IsComplete() ? Continuation::Done : Continuation::Continue;
}

bool PersonalizeAction::IsComplete() {
  return std::visit(
      [](auto&& arg) {
        using T = std::decay_t<decltype(arg)>;
        return std::is_same_v<T, Completed> || std::is_same_v<T, Failed>;
      },
      *state_);
}

void PersonalizeAction::OnAbort(ErrorType error) {
  state_ = std::make_shared<InternalState>(
      Failed{.error = error, .message = "Ntag transaction aborted"});
}

}  // namespace oww::logic::action