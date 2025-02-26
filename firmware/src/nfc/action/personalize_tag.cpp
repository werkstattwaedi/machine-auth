
#include "personalize_tag.h"

#include "../../config.h"

namespace oww::nfc::action {

using namespace config::tag;

PersonalizeTag::PersonalizeTag(
    const std::array<byte, 16>& application_key_bytes,
    const std::array<byte, 16>& terminal_key_bytes,
    const std::array<byte, 16>& card_key_bytes)
    : application_key_bytes_(application_key_bytes),
      terminal_key_bytes_(terminal_key_bytes),
      card_key_bytes_(card_key_bytes) {}

tl::expected<ActionResult, Error> PersonalizeTag::Loop() {
  std::array<byte, 16> factory_default_key = {};

  auto result =
      ntag_interface_->Authenticate(key_application, factory_default_key);
  if (!result) {
    return tl::unexpected(
        Error{.tag_error = result.error(),
              .error_message = "Failed to authenticate key 0"});
  }

  result = ntag_interface_->ChangeKey(key_terminal, factory_default_key,
                                      terminal_key_bytes_, /* key_version */ 1);
  if (!result) {
    return tl::unexpected(Error{.tag_error = result.error(),
                                .error_message = "Failed to change key 1"});
  }

  result = ntag_interface_->ChangeKey(key_authorization, factory_default_key,
                                      card_key_bytes_, /* key_version */ 1);
  if (!result) {
    return tl::unexpected(Error{.tag_error = result.error(),
                                .error_message = "Failed to change key 2"});
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

}  // namespace oww::nfc::action