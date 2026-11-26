// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

#include "pw_function/function.h"

namespace maco::terminal_ui {

/// Actions that screens can emit, handled by the TerminalUi coordinator.
enum class UiAction : uint8_t {
  kNone = 0,
  kOpenMenu,
  kCloseMenu,
  kConfirm,
  kCancel,
  kStopSession,
  kConfirmReleased,  // OK let go (ends a hold on the stop prompt)
};

/// Callback type for screens to emit actions.
using ActionCallback = pw::Function<void(UiAction)>;

}  // namespace maco::terminal_ui
