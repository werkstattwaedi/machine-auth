#include "personalize.h"

#include <type_traits>

#include "../../config.h"
#include "common/hex_util.h"

namespace oww::state::tag {
using namespace personalize;
using namespace config::tag;

std::optional<Personalize> OnWait(Personalize state, Wait &wait,
                                  CloudRequest &cloud_interface) {
  if (millis() < wait.timeout) return {};

  Variant payload;
  auto hex_uid_string = BytesToHexString(state.tag_uid);
  payload.set("uid", Variant(hex_uid_string.c_str()));

  return state.WithNestedState(
      KeyDiversification{.response = cloud_interface.SendTerminalRequest(
                             "presonalization", payload)});
}

std::optional<Personalize> OnKeyDiversification(
    Personalize state, KeyDiversification &diversification,
    CloudRequest &cloud_interface) {
  auto response = diversification.response;
  if (!response->result.has_value()) {
    if (millis() < response->deadline) return {};
    return state.WithNestedState(Failed{.error = ErrorType::kTimeout});
  }

  auto request_result = response->result.value();
  if (!request_result) {
    return state.WithNestedState(Failed{.error = request_result.error()});
  }

  auto payload = request_result.value();

  auto application_key =
      VariantHexStringToBytes<16>(payload.get("application"));
  auto authorization_key =
      VariantHexStringToBytes<16>(payload.get("authorization"));
  auto reserved1_key = VariantHexStringToBytes<16>(payload.get("reserved1"));
  auto reserved2_key = VariantHexStringToBytes<16>(payload.get("reserved2"));

  if (!(application_key && authorization_key && reserved1_key &&
        reserved2_key)) {
    return state.WithNestedState(
        Failed{.error = ErrorType::kMalformedResponse});
  }

  return state.WithNestedState(UpdateTag{
      .application_key = application_key.value(),
      // .terminal_key = configuration_->GetTerminalKey(),
      .card_key = authorization_key.value(),
      .reserved_1_key = reserved1_key.value(),
      .reserved_2_key = reserved2_key.value(),
  });
}

State OnUpdateTag(UpdateTag &update_tag, Ntag424 &ntag_interface) {
  std::array<std::byte, 16> factory_default_key = {};

  if (auto result =
          ntag_interface.Authenticate(key_application, factory_default_key);
      !result) {
    return Failed{.message = String::format(
                      "Authentication failed (reason: %d)", result)};
  }

  if (auto result = ntag_interface.ChangeKey(key_terminal, factory_default_key,
                                             update_tag.terminal_key,
                                             /* key_version */ 1);
      !result) {
    return Failed{
        .message = String::format("ChangeKey(terminal) failed [%d]", result)};
  }

  if (auto result =
          ntag_interface.ChangeKey(key_authorization, factory_default_key,
                                   update_tag.card_key, /* key_version */ 1);
      !result) {
    return Failed{.message =
                      String::format("ChangeKey(auth) failed [%d]", result)};
  }

  if (auto result = ntag_interface.ChangeKey(
          key_reserved_1, factory_default_key, update_tag.reserved_1_key,
          /* key_version */ 1);
      !result) {
    return Failed{
        .message = String::format("ChangeKey(reserved1)failed [%d]", result)};
  }

  if (auto result = ntag_interface.ChangeKey(
          key_reserved_2, factory_default_key, update_tag.reserved_2_key,
          /* key_version */ 1);
      !result) {
    return Failed{
        .message = String::format("ChangeKey(reserved2) failed [%d]", result)};
  }

  // result =
  //     ntag_interface_->ChangeKey0(application_key_bytes_, /* key_version */
  //     1);
  // if (!result) {
  //   logger.error("Failed to change key 1 %d", result.error());
  //   return;
  // }

  return Completed{};
}

// ---- Loop dispatchers ------------------------------------------------------

std::optional<Personalize> StateLoop(Personalize state,
                                     CloudRequest &cloud_interface) {
  if (auto nested = std::get_if<Wait>(state.state.get())) {
    return OnWait(state, *nested, cloud_interface);
  } else if (auto nested = std::get_if<KeyDiversification>(state.state.get())) {
    return OnKeyDiversification(state, *nested, cloud_interface);
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