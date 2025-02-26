#pragma once

#include "action.h"

namespace oww::nfc::action {

class AuthorizeTag : INfcAction {
 public:
  AuthorizeTag(const std::array<byte, 16>& terminal_key_bytes);

  virtual tl::expected<ActionResult, Error> Loop() override;

 private:
  const std::array<byte, 16> terminal_key_bytes_;
};

}  // namespace oww::nfc::action