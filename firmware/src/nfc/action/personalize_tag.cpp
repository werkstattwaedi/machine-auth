
#include "personalize_tag.h"

namespace oww::nfc::action {

PersonalizeTag::PersonalizeTag(
    const std::array<byte, 16>& application_key_bytes,
    const std::array<byte, 16>& terminal_key_bytes,
    const std::array<byte, 16>& card_key_bytes)
    : application_key_bytes_(application_key_bytes),
      terminal_key_bytes_(terminal_key_bytes),
      card_key_bytes_(card_key_bytes) {}

tl::expected<void, Ntag424::DNA_StatusCode> PersonalizeTag::Begin(
    Ntag424* ntag_interface) {
  return {};
}

tl::expected<boolean, Ntag424::DNA_StatusCode> PersonalizeTag::Loop() {
  return {false};
}

}  // namespace oww::nfc::action