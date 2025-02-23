#pragma once

#include "action.h"

namespace oww::nfc::action {

class PersonalizeTag : INfcAction {
 public:
  PersonalizeTag(const std::array<byte, 16>& application_key_bytes,
                 const std::array<byte, 16>& terminal_key_bytes,
                 const std::array<byte, 16>& card_key_bytes);

  virtual tl::expected<void, Ntag424::DNA_StatusCode> Begin(
      Ntag424* ntag_interface) override;

  virtual tl::expected<boolean, Ntag424::DNA_StatusCode> Loop() override;

 private:
  const std::array<byte, 16> application_key_bytes_;
  const std::array<byte, 16> terminal_key_bytes_;
  const std::array<byte, 16> card_key_bytes_;
};

}  // namespace oww::nfc::action