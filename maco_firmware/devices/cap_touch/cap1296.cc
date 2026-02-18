// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "CAP1296"

#include "maco_firmware/devices/cap_touch/cap1296.h"

#include <chrono>

#include "pw_bytes/endian.h"
#include "pw_log/log.h"

namespace maco::display {

using namespace std::chrono_literals;

static constexpr auto kTimeout = 50ms;

Cap1296::Cap1296(pw::i2c::Initiator& i2c)
    : device_(i2c,
              pw::i2c::Address::SevenBit<kDefaultAddress>(),
              pw::endian::big,
              pw::i2c::RegisterAddressSize::k1Byte) {}

pw::Result<uint8_t> Cap1296::ReadReg(Reg reg) {
  return device_.ReadRegister8(static_cast<uint32_t>(reg), kTimeout);
}

pw::Status Cap1296::WriteReg(Reg reg, uint8_t value) {
  return device_.WriteRegister8(static_cast<uint32_t>(reg), value, kTimeout);
}

pw::Status Cap1296::Init() {
  PW_TRY_ASSIGN(const uint8_t product_id, ReadReg(Reg::kProductId));
  if (product_id != kExpectedProductId) {
    PW_LOG_ERROR("Unexpected product ID 0x%02x (expected 0x%02x)",
                 product_id, kExpectedProductId);
    return pw::Status::NotFound();
  }

  PW_TRY_ASSIGN(const uint8_t mfr_id, ReadReg(Reg::kManufacturerId));
  if (mfr_id != kExpectedManufacturerId) {
    PW_LOG_ERROR("Unexpected manufacturer ID 0x%02x (expected 0x%02x)",
                 mfr_id, kExpectedManufacturerId);
    return pw::Status::NotFound();
  }

  // Configure channels 0, 1, 3, 4 (the four buttons we use)
  constexpr uint8_t kEnabledChannels = 0b00011011;
  PW_TRY(WriteReg(Reg::kSignalGuardEnable, kEnabledChannels));
  PW_TRY(WriteReg(Reg::kSensorInputEnable, kEnabledChannels));
  PW_TRY(WriteReg(Reg::kMultipleTouchConfig, 0x00));
  PW_TRY(WriteReg(Reg::kStandbyConfig, 0x30));
  PW_TRY(WriteReg(Reg::kInterruptEnable, kEnabledChannels));

  PW_LOG_INFO("Initialized (product=0x%02x, mfr=0x%02x)", product_id, mfr_id);
  return pw::OkStatus();
}

uint8_t Cap1296::Touched() {
  const auto status = ReadReg(Reg::kSensorInputStatus);
  if (!status.ok()) {
    return 0;
  }

  const uint8_t touched = *status;

  if (touched) {
    // Clear INT so the device can update status on next sample
    const auto main_ctrl = ReadReg(Reg::kMainControl);
    if (main_ctrl.ok()) {
      (void)WriteReg(Reg::kMainControl, *main_ctrl & ~0x01);
    }
  }

  return touched;
}

}  // namespace maco::display
