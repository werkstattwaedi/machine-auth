// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/ui/screen.h"
#include "pw_string/string_builder.h"

namespace maco::dev {

/// Test screen displaying NFC reader status.
/// Shows "No card" or the card UID when a tag is present.
class NfcTestScreen : public ui::Screen {
 public:
  explicit NfcTestScreen(nfc::NfcReader& nfc_reader);

  pw::Status OnActivate() override;
  void OnDeactivate() override;
  void OnUpdate() override;
  ui::ButtonConfig GetButtonConfig() const override;

 private:
  void UpdateNfcStatus();
  static void FormatUidTo(pw::StringBuilder& out, pw::ConstByteSpan uid);

  nfc::NfcReader& nfc_reader_;
  lv_obj_t* status_label_ = nullptr;

  // Status text buffer with dirty flag
  bool status_dirty_ = true;
  pw::StringBuffer<64> status_text_;
};

}  // namespace maco::dev
