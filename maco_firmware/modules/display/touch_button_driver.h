// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

#include "lvgl.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::display {

// Abstract touch button input driver interface
// Platform-specific implementations provide button input
// (keyboard for host, capacitive touch for hardware)
class TouchButtonDriver {
 public:
  virtual ~TouchButtonDriver() = default;

  // Initialize the input hardware
  virtual pw::Status Init() = 0;

  // Create and configure the LVGL input device
  // The driver sets up read callback internally
  // Returns the lv_indev_t* on success
  virtual pw::Result<lv_indev_t*> CreateLvglInputDevice() = 0;

  // Read raw touch bitmask for direct access (e.g. factory tests).
  // Returns 0 if unsupported or no touch detected.
  virtual uint8_t Touched() { return 0; }
};

}  // namespace maco::display
