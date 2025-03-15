#include "authorize.h"

#include "../../config.h"

namespace oww::state::tag::authorize {
using namespace config::tag;

State Start::Process(Ntag424 &ntag_interface) {
  auto auth_challenge = ntag_interface.AuthenticateWithCloud_Begin(key_number);
  if (!auth_challenge) {
    return Failed{.tag_status = auth_challenge.error()};
  }

  return {NtagChallenge{.auth_challenge = auth_challenge.value()}};
}

State NtagChallenge::Process(
  std::array<std::byte, 7> tag_uid,
  CloudRequest &cloud_interface) {


  Variant payload;
  payload.set("uid", Variant(card_uid_result.value()->toHex()));
  payload.set("challenge",
              Variant(authentication_begin_result.value()->toHex()));
  Particle.publish("terminal-authentication", payload);

  cloud_interface.SendTerminalRequest();


  auto auth_challenge = ntag_interface.AuthenticateWithCloud_Begin(key_number);
  if (!auth_challenge) {
    return Failed{.tag_status = auth_challenge.error()};
  }

  return {NtagChallenge{.auth_challenge = auth_challenge.value()}};
}


}  // namespace oww::state::tag::authorize
