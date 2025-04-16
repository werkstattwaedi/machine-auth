#include "personalize.h"

#include <type_traits>

#include "../../config.h"
#include "common/byte_array.h"
#include "common/debug.h"
#include "state/cloud_request.h"
#include "state/configuration.h"

namespace oww::state::tag {
using namespace personalize;
using namespace config::tag;

std::optional<Personalize> OnWait(Personalize state, Wait &wait,
                                  CloudRequest &cloud_interface) {
  if (millis() < wait.timeout) return {};
  using namespace oww::personalization;

  KeyDiversificationRequestT request;
  request.token_id = std::make_unique<oww::ntag::TagUid>();

  return state.WithNestedState(KeyDiversification{
      .response =
          cloud_interface.SendTerminalRequest<KeyDiversificationRequestT,
                                              KeyDiversificationResponseT>(
              "personalization", request)});
}

std::optional<Personalize> OnKeyDiversification(
    Personalize state, KeyDiversification &diversification,
    Configuration &configuration, CloudRequest &cloud_interface) {
  auto response = diversification.response;
  if (!response->result.has_value()) {
    if (millis() < response->deadline) return {};
    return state.WithNestedState(Failed{.error = ErrorType::kTimeout});
  }

  auto request_result = response->result.value();
  if (!request_result) {
    return state.WithNestedState(Failed{.error = request_result.error()});
  }

  return state.WithNestedState(UpdateTag{
      .application_key = request_result->application_key,
      .terminal_key = configuration.GetTerminalKey(),
      .card_key = authorization_key.value(),
      .reserved_1_key = reserved1_key.value(),
      .reserved_2_key = reserved2_key.value(),
  });
}

tl::expected<std::array<std::byte, 16>, Ntag424::DNA_StatusCode> ProbeKeys(
    Ntag424 &ntag_interface, Ntag424Key key_no,
    std::vector<std::array<std::byte, 16> > keys) {
  for (auto key : keys) {
    auto result = ntag_interface.Authenticate(key_no, key);
    if (result) return key;
  }

  return tl::unexpected(Ntag424::DNA_StatusCode::AUTHENTICATION_ERROR);
};

State OnUpdateTag(UpdateTag &update_tag, Ntag424 &ntag_interface) {
  std::array<std::byte, 16> factory_default_key = {};

  auto current_key_0 =
      ProbeKeys(ntag_interface, key_application,
                {factory_default_key, update_tag.application_key});
  if (!current_key_0) return Failed{.message = "Cant authenticate key 0"};

  auto current_key_1 =
      ProbeKeys(ntag_interface, key_terminal,
                {factory_default_key, update_tag.terminal_key});
  if (!current_key_1) return Failed{.message = "Cant authenticate key 1"};

  auto current_key_2 = ProbeKeys(ntag_interface, key_authorization,
                                 {factory_default_key, update_tag.card_key});
  if (!current_key_2) return Failed{.message = "Cant authenticate key 2"};

  auto current_key_3 =
      ProbeKeys(ntag_interface, key_reserved_1,
                {factory_default_key, update_tag.reserved_1_key});
  if (!current_key_3) return Failed{.message = "Cant authenticate key 3"};

  auto current_key_4 =
      ProbeKeys(ntag_interface, key_reserved_2,
                {factory_default_key, update_tag.reserved_2_key});
  if (!current_key_4) return Failed{.message = "Cant authenticate key 4"};

  if (auto result =
          ntag_interface.Authenticate(key_application, current_key_0.value());
      !result) {
    return Failed{.message = String::format(
                      "Authentication failed (reason: %d)", result)};
  }

  if (auto result = ntag_interface.ChangeKey(
          key_terminal, current_key_1.value(), update_tag.terminal_key,
          /* key_version */ 1);
      !result) {
    return Failed{
        .message = String::format("ChangeKey(terminal) failed [%d]", result)};
  }

  if (auto result =
          ntag_interface.ChangeKey(key_authorization, current_key_2.value(),
                                   update_tag.card_key, /* key_version */ 1);
      !result) {
    return Failed{.message =
                      String::format("ChangeKey(auth) failed [%d]", result)};
  }

  if (auto result = ntag_interface.ChangeKey(
          key_reserved_1, current_key_3.value(), update_tag.reserved_1_key,
          /* key_version */ 1);
      !result) {
    return Failed{
        .message = String::format("ChangeKey(reserved1)failed [%d]", result)};
  }

  if (auto result = ntag_interface.ChangeKey(
          key_reserved_2, current_key_4.value(), update_tag.reserved_2_key,
          /* key_version */ 1);
      !result) {
    return Failed{
        .message = String::format("ChangeKey(reserved2) failed [%d]", result)};
  }

  if (auto result = ntag_interface.ChangeKey0(
          update_tag.application_key, /* key_version */
          1);
      !result) {
    return Failed{.message = String::format(
                      "ChangeKey(application) failed [%d]", result)};
  }

  return Completed{};
}

// ---- Loop dispatchers ------------------------------------------------------

std::optional<Personalize> StateLoop(Personalize state,
                                     Configuration &configuration,
                                     CloudRequest &cloud_interface) {
  if (auto nested = std::get_if<Wait>(state.state.get())) {
    return OnWait(state, *nested, cloud_interface);
  } else if (auto nested = std::get_if<KeyDiversification>(state.state.get())) {
    return OnKeyDiversification(state, *nested, configuration, cloud_interface);
  }

  return {};
}

std::optional<Personalize> NfcLoop(Personalize state, Ntag424 &ntag_interface) {
  if (auto nested = std::get_if<UpdateTag>(state.state.get())) {
    return state.WithNestedState(OnUpdateTag(*nested, ntag_interface));
  }

  return {};
}

Personalize Personalize::WithNestedState(State nested_state) {
  return Personalize{.tag_uid = tag_uid,
                     .state = std::make_shared<State>(nested_state)};
}

}  // namespace oww::state::tag