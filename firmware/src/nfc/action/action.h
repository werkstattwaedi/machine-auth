#pragma once

#include "../../common.h"
#include "../driver/Ntag424.h"

namespace oww::nfc::action {



struct ResultComplete {};

struct ResultInvokeService {
  String service;
  std::unique_ptr<Variant> payload;
};


struct Error {
  Ntag424::DNA_StatusCode tag_error;
  String error_message;
};

using ActionResponse = std::variant<Completed, InvokeService>;

class INfcAction {
 public:
  virtual tl::expected<void, Ntag424::DNA_StatusCode> Begin(
      Ntag424* ntag_interface) {
    ntag_interface_ = ntag_interface;
    return {};
  }

  virtual tl::expected<ActionResult, Error> Loop() = 0;

 protected:
  Ntag424* ntag_interface_ = nullptr;
};

}  // namespace oww::nfc::action