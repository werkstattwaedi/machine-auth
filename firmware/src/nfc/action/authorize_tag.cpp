#include "authorize_tag.h"

#include "../../config.h"
#include "../nfc_tags.h"

namespace oww::nfc::action {

tl::expected<Response, Error> AuthorizeTag::Loop(NfcTags& tags) {
  auto card_uid_result = tags.ntag_interface_->GetCardUID();
  if (!card_uid_result) {
    return tl::unexpected(Error{.tag_error = card_uid_result.error() });
  }

  memcpy(uid_, card_uid_result.value().get(), sizeof(uid_));

  auto authentication_begin_result =
      tags.ntag_interface_->AuthenticateWithCloud_Begin(
          config::tag::key_authorization);
  if (!authentication_begin_result) {
    return tl::unexpected(
        Error{.tag_error = authentication_begin_result.error()});
  }

  Variant payload;
  payload.set("uid", Variant(card_uid_result.value()->toHex()));
  payload.set("challenge",
              Variant(authentication_begin_result.value()->toHex()));
  Particle.publish("terminal-authentication", payload);
  return {Suspend{}};
}

}  // namespace oww::nfc::action
