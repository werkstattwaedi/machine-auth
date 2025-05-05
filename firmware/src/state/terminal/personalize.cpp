#include "personalize.h"

#include <type_traits>

#include "../../config.h"
#include "common/byte_array.h"
#include "common/debug.h"
#include "state/cloud_response.h"
#include "state/configuration.h"
#include "state/state.h"

namespace oww::state::terminal {
using namespace personalize;
using namespace config::tag;

void UpdateNestedState(oww::state::State &state_manager, Personalize last_state,
                       personalize::State updated_nested_state) {
  state_manager.lock();
  state_manager.OnNewState(Personalize{
      .tag_uid = last_state.tag_uid,
      .state = std::make_shared<personalize::State>(updated_nested_state)});
  state_manager.unlock();
}

void UpdateFailedState(oww::state::State &state_manager, Personalize last_state,
                       String failure_message) {
  UpdateNestedState(state_manager, last_state,
                    Failed{.message = failure_message});
}

void OnWait(Personalize state, Wait &wait, oww::state::State &state_manager) {
  if (millis() < wait.timeout) return;
  using namespace oww::personalization;

  KeyDiversificationRequestT request;
  request.token_id = std::make_unique<oww::ntag::TagUid>(
      flatbuffers::span<uint8_t, 7>(state.tag_uid));

  UpdateNestedState(
      state_manager, state,
      AwaitKeyDiversificationResponse{
          .response =
              state_manager.SendTerminalRequest<KeyDiversificationRequestT,
                                                KeyDiversificationResponseT>(
                  "personalization", request)});
}

void OnAwaitKeyDiversificationResponse(
    Personalize state, AwaitKeyDiversificationResponse &response_holder,
    oww::state::State &state_manager) {
  auto cloud_response = response_holder.response.get();
  if (IsPending(*cloud_response)) {
    return;
  }

  // }

  // auto request_result = response->result.value();
  // if (!request_result) {
  //   return state.WithNestedState(Failed{.error = request_result.error()});
  // }

  // auto payload = request_result.value();

  // return state.WithNestedState(UpdateTag{
  //     .application_key = payload.application_key,
  //     .terminal_key = configuration.GetTerminalKey(),
  //     .card_key = authorization_key.value(),
  //     .reserved_1_key = reserved1_key.value(),
  //     .reserved_2_key = reserved2_key.value(),
  // });
}

tl::expected<std::array<uint8_t, 16>, Ntag424::DNA_StatusCode> ProbeKeys(
    Ntag424 &ntag_interface, Ntag424Key key_no,
    std::vector<std::array<uint8_t, 16>> keys) {
  for (auto key : keys) {
    auto result = ntag_interface.Authenticate(key_no, key);
    if (result) return key;
  }

  return tl::unexpected(Ntag424::DNA_StatusCode::AUTHENTICATION_ERROR);
};

void OnDoPersonalizeTag(Personalize state, DoPersonalizeTag &update_tag,
                        Ntag424 &ntag_interface,
                        oww::state::State &state_manager) {
  std::array<uint8_t, 16> factory_default_key = {};

  auto current_key_0 =
      ProbeKeys(ntag_interface, key_application,
                {factory_default_key, update_tag.application_key});
  if (!current_key_0) {
    return UpdateFailedState(state_manager, state, "Cant authenticate key 0");
  }

  auto current_key_1 =
      ProbeKeys(ntag_interface, key_terminal,
                {factory_default_key, update_tag.terminal_key});
  if (!current_key_1) {
    return UpdateFailedState(state_manager, state, "Cant authenticate key 1");
  }
  auto current_key_2 = ProbeKeys(ntag_interface, key_authorization,
                                 {factory_default_key, update_tag.card_key});
  if (!current_key_2) {
    return UpdateFailedState(state_manager, state, "Cant authenticate key 2");
  }

  auto current_key_3 =
      ProbeKeys(ntag_interface, key_reserved_1,
                {factory_default_key, update_tag.reserved_1_key});
  if (!current_key_3) {
    return UpdateFailedState(state_manager, state, "Cant authenticate key 3");
  }

  auto current_key_4 =
      ProbeKeys(ntag_interface, key_reserved_2,
                {factory_default_key, update_tag.reserved_2_key});
  if (!current_key_4) {
    return UpdateFailedState(state_manager, state, "Cant authenticate key 4");
  }

  if (auto result =
          ntag_interface.Authenticate(key_application, current_key_0.value());
      !result) {
    return UpdateFailedState(
        state_manager, state,
        String::format("Authentication failed (reason: %d)", result));
  }

  if (auto result = ntag_interface.ChangeKey(
          key_terminal, current_key_1.value(), update_tag.terminal_key,
          /* key_version */ 1);
      !result) {
    return UpdateFailedState(
        state_manager, state,
        String::format("ChangeKey(terminal) failed [%d]", result));
  }

  if (auto result =
          ntag_interface.ChangeKey(key_authorization, current_key_2.value(),
                                   update_tag.card_key, /* key_version */ 1);
      !result) {
    return UpdateFailedState(
        state_manager, state,
        String::format("ChangeKey(auth) failed [%d]", result));
  }

  if (auto result = ntag_interface.ChangeKey(
          key_reserved_1, current_key_3.value(), update_tag.reserved_1_key,
          /* key_version */ 1);
      !result) {
    return UpdateFailedState(
        state_manager, state,
        String::format("ChangeKey(reserved1)failed [%d]", result));
  }

  if (auto result = ntag_interface.ChangeKey(
          key_reserved_2, current_key_4.value(), update_tag.reserved_2_key,
          /* key_version */ 1);
      !result) {
    return UpdateFailedState(
        state_manager, state,
        String::format("ChangeKey(reserved2) failed [%d]", result));
  }

  if (auto result = ntag_interface.ChangeKey0(
          update_tag.application_key, /* key_version */
          1);
      !result) {
    return UpdateFailedState(
        state_manager, state,
        String::format("ChangeKey(application) failed [%d]", result));
  }

  UpdateNestedState(state_manager, state, Completed{});
}

// ---- Loop dispatchers ------------------------------------------------------

void Loop(Personalize state, oww::state::State &state_manager,
          Ntag424 &ntag_interface) {
  if (auto nested = std::get_if<Wait>(state.state.get())) {
    OnWait(state, *nested, state_manager);
  } else if (auto nested = std::get_if<AwaitKeyDiversificationResponse>(
                 state.state.get())) {
    OnAwaitKeyDiversificationResponse(state, *nested, state_manager);
  } else if (auto nested = std::get_if<DoPersonalizeTag>(state.state.get())) {
    OnDoPersonalizeTag(state, *nested, ntag_interface, state_manager);
  }
}

}  // namespace oww::state::terminal