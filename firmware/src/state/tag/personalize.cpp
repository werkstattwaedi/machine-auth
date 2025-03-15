#include "personalize.h"

#include "../../config.h"

namespace oww::state::tag::personalize {
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

}  // namespace oww::state::tag::personalize
