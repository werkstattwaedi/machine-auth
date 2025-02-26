#pragma once

#include "../../common.h"
#include "../../state/state.h"
#include "../driver/Ntag424.h"

class NfcTags;

namespace oww::nfc::action {

struct Complete {};
struct Suspend {};

using Response = std::variant<Complete, Suspend>;

struct Error {
  Ntag424::DNA_StatusCode tag_error;
  String error_message;
};

class INfcAction {
 public:
  virtual tl::expected<Response, Error> Loop(NfcTags& pcd) = 0;
};

}  // namespace oww::nfc::action