#include "drivers/touch/cap1296.h"

namespace oww::drivers::touch {
Logger cap1296_log("cap1296");

CAP1296::CAP1296() {}

Status CAP1296::Begin(uint8_t i2c_addr) {
  Wire.begin();
  i2c_addr_ = i2c_addr;

  if (cap1296_log.isTraceEnabled()) {
    cap1296_log.info("Product ID: 0x%02x", ReadRegister(Register::kProductId));
    cap1296_log.info("Manufacturer  ID: 0x%02x",
                     ReadRegister(Register::kManufacturerId));
    cap1296_log.info("Revision: 0x%02x", ReadRegister(Register::kRevision));
  }

  if ((ReadRegister(Register::kProductId) != 0x69) ||
      (ReadRegister(Register::kManufacturerId) != 0x5D)) {
    return Status::kError;
  }

  WriteRegister(Register::kSignalGuardEnable, 0b00011011);
  WriteRegister(Register::kSensorInputEnable, 0b00011011);

  WriteRegister(Register::kMultipleTouchConfiguration, 0);
  WriteRegister(Register::kStandbyConfig, 0x30);
  WriteRegister(Register::kInterruptEnable, 0b00011011);
  return Status::kOk;
}

uint8_t CAP1296::Touched() {
  uint8_t t = ReadRegister(Register::kSensorInputStatus);
  if (t) {
    // Reset interrupt flag
    WriteRegister(Register::kMainControl,
                  ReadRegister(Register::kMainControl) & ~0x01);
  }
  return t;
}

uint8_t CAP1296::ReadRegister(Register reg) {
  Wire.beginTransmission(i2c_addr_);
  Wire.write(static_cast<uint8_t>(reg));
  Wire.endTransmission();
  Wire.requestFrom(i2c_addr_, 1);
  return Wire.read();
}

void CAP1296::WriteRegister(Register reg, uint8_t value) {
  Wire.beginTransmission(i2c_addr_);
  Wire.write(static_cast<uint8_t>(reg));
  Wire.write(value);
  Wire.endTransmission();
}

}  // namespace oww::drivers::touch
