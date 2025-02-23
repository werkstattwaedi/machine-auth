#pragma once

#include "../../common.h"
#include "../driver/Ntag424.h"

namespace oww::nfc::action {

class INfcAction {
 public:
  virtual tl::expected<void, Ntag424::DNA_StatusCode> Begin(
      Ntag424* ntag_interface) = 0;

  virtual tl::expected<boolean, Ntag424::DNA_StatusCode> Loop() = 0;
};

}  // namespace oww::nfc::action