// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/modules/ui/data_binding.h"
#include "maco_firmware/modules/ui/screen.h"
#include "pw_string/string_builder.h"

namespace maco::dev {

/// Test screen displaying NFC reader status and tag verification.
/// Receives state via OnUpdate() from AppShell (no direct NfcReader access).
class NfcTestScreen : public ui::Screen {
 public:
  NfcTestScreen();

  pw::Status OnActivate() override;
  void OnDeactivate() override;
  void OnUpdate(const app_state::AppStateSnapshot& snapshot) override;
  ui::ButtonConfig GetButtonConfig() const override;

 private:
  void UpdateStatusText(const app_state::AppStateSnapshot& snapshot);
  static void FormatUidTo(pw::StringBuilder& out, const app_state::TagUid& uid);

  lv_obj_t* status_label_ = nullptr;

  // Watched state for dirty checking
  ui::Watched<app_state::AppStateId> state_watched_{
      app_state::AppStateId::kIdle};
  pw::StringBuffer<64> status_text_;
};

}  // namespace maco::dev
