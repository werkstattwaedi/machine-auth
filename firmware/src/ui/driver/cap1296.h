#pragma once

#include "Particle.h"
#include "common.h"

namespace oww::ui::driver::cap {

// Default I2C address
constexpr uint8_t kCap1296ddr = 0x28;
enum class Register : uint8_t;

class CAP1296 {
 public:
  CAP1296();

  Status Begin(uint8_t i2c_addr = kCap1296ddr);
  uint8_t Touched();

 private:
  uint8_t ReadRegister(Register reg);
  void WriteRegister(Register reg, uint8_t value);

  int8_t i2c_addr_;
};

enum class Register : uint8_t {
  kMainControl = 0x00,
  kGeneralStatus = 0x02,
  kSensorInputStatus = 0x03,
  kNoiseFlagStatus = 0x0A,
  kSensorInput1DeltaCount = 0x10,
  kSensorInput2DeltaCount = 0x11,
  kSensorInput3DeltaCount = 0x12,
  kSensorInput4DeltaCount = 0x13,
  kSensorInput5DeltaCount = 0x14,
  kSensorInput6DeltaCount = 0x15,
  kSensitivityControl = 0x1F,
  kGeneralConfiguration = 0x20,
  kSensorInputEnable = 0x21,
  kSensorInputConfiguration = 0x22,
  kSensorInputConfiguration2 = 0x23,
  kAveragingAndSamplingConfig = 0x24,
  kCalibrationActivate = 0x26,
  kInterruptEnable = 0x27,
  kRepeatRateEnable = 0x28,
  kSignalGuardEnable = 0x29,
  kMultipleTouchConfiguration = 0x2A,
  kMultipleTouchPatternConfiguration = 0x2B,
  kMultipleTouchPattern = 0x2D,
  kBaseCountOutOfLimit = 0x2E,
  kRecalibrationConfiguration = 0x2F,
  kSensorInput1Threshold = 0x30,
  kSensorInput2Threshold = 0x31,
  kSensorInput3Threshold = 0x32,
  kSensorInput4Threshold = 0x33,
  kSensorInput5Threshold = 0x34,
  kSensorInput6Threshold = 0x35,
  kSensorInputNoiseThreshold = 0x38,
  kStandbyChannel = 0x40,
  kStandbyConfig = 0x41,
  kStandbySensitivity = 0x42,
  kStandbyThreshold = 0x43,
  kConfiguration2 = 0x44,
  kSensorInput1BaseCount = 0x50,
  kSensorInput2BaseCount = 0x51,
  kSensorInput3BaseCount = 0x52,
  kSensorInput4BaseCount = 0x53,
  kSensorInput5BaseCount = 0x54,
  kSensorInput6BaseCount = 0x55,
  kPowerButton = 0x60,
  kPowerButtonConfiguration = 0x61,
  kCalibrationSensitivityConfiguration1 = 0x80,
  kCalibrationSensitivityConfiguration2 = 0x81,
  kSensorInput1Calibration = 0xB1,
  kSensorInput2Calibration = 0xB2,
  kSensorInput3Calibration = 0xB3,
  kSensorInput4Calibration = 0xB4,
  kSensorInput5Calibration = 0xB5,
  kSensorInput6Calibration = 0xB6,
  kSensorInputCalibrationLSB1 = 0xB9,
  kSensorInputCalibrationLSB2 = 0xBA,
  kProductId = 0xFD,
  kManufacturerId = 0xFE,
  kRevision = 0xFF,
};

}  // namespace oww::ui::driver::cap
