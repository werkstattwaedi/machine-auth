// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Minimal HAL-level bridge from Particle Device OS logging to pw_log.

#pragma once

namespace pb::log {

// Initialize the log bridge. Call this early in setup() to intercept
// all Device OS system logs and route them through pw_log.
void InitLogBridge();

}  // namespace pb::log
