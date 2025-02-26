#pragma once

#include "action.h"

namespace oww::nfc::action {

class PersonalizeTag : INfcAction {
 public:
  PersonalizeTag(const std::array<byte, 16>& application_key_bytes,
                 const std::array<byte, 16>& terminal_key_bytes,
                 const std::array<byte, 16>& card_key_bytes);

  virtual tl::expected<Response, Error> Loop(NfcTags& pcd) override;

 private:
  const std::array<byte, 16> application_key_bytes_;
  const std::array<byte, 16> terminal_key_bytes_;
  const std::array<byte, 16> card_key_bytes_;
};

}  // namespace oww::nfc::action