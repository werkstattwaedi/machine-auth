// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_function/function.h"

// The functions in this file return specific implementations of singleton types
// provided by the system.

namespace maco::display {
class DisplayDriver;
class TouchButtonDriver;
}  // namespace maco::display

namespace maco::system {

/// Initializes the system, first performing target-specific initialization,
/// and then invoking the app_init continuation function to perform app-specific
/// initialization. Once that completes and returns, the main system scheduler
/// is started.
///
/// This function never returns, and should be called from the start of `main`.
[[noreturn]] void Init(pw::Function<void()> app_init);

/// Returns the platform-specific display driver instance.
/// Host: SdlDisplayDriver, P2: PicoRes28LcdDriver
maco::display::DisplayDriver& GetDisplayDriver();

/// Returns the platform-specific touch button input driver instance.
/// Host: KeyboardInputDriver, P2: CapTouchInputDriver
maco::display::TouchButtonDriver& GetTouchButtonDriver();

}  // namespace maco::system
