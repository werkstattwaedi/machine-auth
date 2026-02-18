// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

#include "pw_i2c/initiator.h"
#include "pw_i2c/register_device.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::display {

/// Driver for CAP1296 6-channel capacitive touch controller.
/// Uses pw::i2c::RegisterDevice for register-level I2C access.
class Cap1296 {
 public:
  /// Default 7-bit I2C address for CAP1296.
  static constexpr uint8_t kDefaultAddress = 0x28;

  explicit Cap1296(pw::i2c::Initiator& i2c);

  /// Initialize and verify the CAP1296 device.
  /// Checks product and manufacturer IDs, then configures sensitivity
  /// and input channels.
  pw::Status Init();

  /// Read which channels are currently touched.
  /// Returns a 6-bit bitmask (bit 0 = channel 0, etc.).
  /// Clears the interrupt flag after reading.
  uint8_t Touched();

 private:
  // CAP1296 register addresses
  enum class Reg : uint8_t {
    kMainControl = 0x00,
    kSensorInputStatus = 0x03,
    kSensorInputEnable = 0x21,
    kInterruptEnable = 0x27,
    kRepeatRateEnable = 0x28,
    kSignalGuardEnable = 0x29,
    kMultipleTouchConfig = 0x2A,
    kMultipleTouchPattern = 0x2D,
    kRecalibrationConfig = 0x2F,
    kSensorInputThresh0 = 0x30,
    kSensorInputThresh1 = 0x31,
    kSensorInputThresh2 = 0x32,
    kSensorInputThresh3 = 0x33,
    kSensorInputThresh4 = 0x34,
    kSensorInputThresh5 = 0x35,
    kStandbyChannel = 0x40,
    kStandbyConfig = 0x41,
    kStandbyThreshold = 0x43,
    kProductId = 0xFD,
    kManufacturerId = 0xFE,
    kRevision = 0xFF,
  };

  static constexpr uint8_t kExpectedProductId = 0x69;
  static constexpr uint8_t kExpectedManufacturerId = 0x5D;

  pw::Result<uint8_t> ReadReg(Reg reg);
  pw::Status WriteReg(Reg reg, uint8_t value);

  pw::i2c::RegisterDevice device_;
};

}  // namespace maco::display
