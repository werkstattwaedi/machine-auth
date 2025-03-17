#include "personalize.h"

#include "../../config.h"
#include "common/hex_util.h"

namespace oww::state::tag {
std::optional<Personalize> StateLoop(Personalize state,
                                     CloudRequest &cloud_interface) {
  auto nested_state = state.state;
  if (auto wait_state =
          std::get_if<tag::personalize::Wait>(nested_state.get())) {
    if (millis() < wait_state->timeout) return {};

    Variant payload;
    auto hex_uid_string = BytesToHexString(state.tag_uid);
    payload.set("uid", Variant(hex_uid_string.c_str()));
    if (auto request_result =
            cloud_interface.SendTerminalRequest("presonalization", payload)) {
      auto result = state;
      result.state = std::make_shared<tag::personalize::State>(
          tag::personalize::RequestedKeys{.request_id =
                                              request_result.value()});

      return result;
    } else {
      // TODO: limit retry
    }
  }
  return {};
}

namespace personalize {
using namespace config::tag;

State PersonalizeTag(Ntag424 &ntag_interface, std::array<std::byte, 7> tag_uid,
                     UpdateTag update_tag) {
  std::array<std::byte, 16> factory_default_key = {};

  auto result =
      ntag_interface.Authenticate(key_application, factory_default_key);
  if (!result) {
    return Failed{};
  }

  result =
      ntag_interface.ChangeKey(key_terminal, factory_default_key,
                               update_tag.terminal_key, /* key_version */ 1);
  if (!result) {
    return Failed{};
  }

  result = ntag_interface.ChangeKey(key_authorization, factory_default_key,
                                    update_tag.card_key, /* key_version */ 1);
  if (!result) {
    return Failed{};
  }

  // result =
  //     ntag_interface_->ChangeKey0(application_key_bytes_, /* key_version */
  //     1);
  // if (!result) {
  //   logger.error("Failed to change key 1 %d", result.error());
  //   return;
  // }

  return {Completed{}};
}

}  // namespace personalize
}  // namespace oww::state::tag