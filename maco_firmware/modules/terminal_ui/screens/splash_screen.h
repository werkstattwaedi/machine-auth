// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/modules/ui/screen.h"

namespace maco::terminal_ui {

/// Boot splash screen with OWW logo and "MACO" subtitle.
/// Static content - no OnUpdate needed. Auto-dismissed by coordinator.
class SplashScreen : public ui::Screen<app_state::AppStateSnapshot> {
 public:
  SplashScreen();

  pw::Status OnActivate() override;
  void OnDeactivate() override;
};

}  // namespace maco::terminal_ui
