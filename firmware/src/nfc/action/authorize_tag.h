#pragma once

#include "action.h"

namespace oww::nfc::action {

class AuthorizeTag : INfcAction {
 public:
  virtual tl::expected<Response, Error> Loop(NfcTags& tags) override;

 private:
  byte uid_[7];
};

}  // namespace oww::nfc::action