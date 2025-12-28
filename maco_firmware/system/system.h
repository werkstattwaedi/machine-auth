// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_function/function.h"

// The functions in this file return specific implementations of singleton types
// provided by the system.

namespace maco::system {

/// Initializes the system, first performing target-specific initialization,
/// and then invoking the app_init continuation function to perform app-specific
/// initialization. Once that completes and returns, the main system scheduler
/// is started.
///
/// This function never returns, and should be called from the start of `main`.
[[noreturn]] void Init(pw::Function<void()> app_init);

}  // namespace maco::system
