// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

#include "lvgl.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::display {

// Abstract display driver interface
// Platform-specific implementations provide the actual display backend
// (SDL for host, SPI LCD for hardware)
class DisplayDriver {
 public:
  virtual ~DisplayDriver() = default;

  // Initialize the display hardware (SDL window, SPI bus, etc.)
  virtual pw::Status Init(uint16_t width, uint16_t height) = 0;

  // Create and configure the LVGL display
  // The driver sets up flush callback and draw buffers internally
  // Returns the lv_display_t* on success
  virtual pw::Result<lv_display_t*> CreateLvglDisplay() = 0;

  // Get display dimensions
  virtual uint16_t width() const = 0;
  virtual uint16_t height() const = 0;
};

}  // namespace maco::display
