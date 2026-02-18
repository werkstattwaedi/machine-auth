// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "I2C"

#include "pb_i2c/initiator.h"

#include "i2c_hal.h"
#include "pw_log/log.h"

namespace pb {
namespace {

hal_i2c_interface_t ToHalInterface(ParticleI2cInitiator::Interface interface) {
  switch (interface) {
    case ParticleI2cInitiator::Interface::kWire:
      return HAL_I2C_INTERFACE1;
    case ParticleI2cInitiator::Interface::kWire1:
      return HAL_I2C_INTERFACE2;
  }
  return HAL_I2C_INTERFACE1;
}

}  // namespace

ParticleI2cInitiator::ParticleI2cInitiator(Interface interface,
                                           uint32_t clock_hz)
    : Initiator(Feature::kStandard),
      interface_(interface),
      clock_hz_(clock_hz) {}

ParticleI2cInitiator::~ParticleI2cInitiator() {
  if (initialized_) {
    hal_i2c_end(ToHalInterface(interface_), nullptr);
  }
}

void ParticleI2cInitiator::LazyInit() {
  if (initialized_) {
    return;
  }

  const auto hal_if = ToHalInterface(interface_);
  hal_i2c_init(hal_if, nullptr);
  hal_i2c_set_speed(hal_if, clock_hz_, nullptr);
  hal_i2c_begin(hal_if, I2C_MODE_MASTER, 0x00, nullptr);
  initialized_ = true;

  PW_LOG_INFO("I2C%d initialized at %u Hz",
              static_cast<int>(interface_),
              static_cast<unsigned>(clock_hz_));
}

pw::Status ParticleI2cInitiator::DoWriteReadFor(
    pw::i2c::Address device_address,
    pw::ConstByteSpan tx_buffer,
    pw::ByteSpan rx_buffer,
    pw::chrono::SystemClock::duration timeout) {
  LazyInit();

  const auto hal_if = ToHalInterface(interface_);
  const uint8_t addr_7bit = device_address.GetSevenBit();

  // Convert timeout to milliseconds
  const auto timeout_ms = static_cast<uint32_t>(
      std::chrono::duration_cast<std::chrono::milliseconds>(timeout).count());

  // Build TX config (if we have data to write)
  hal_i2c_transmission_config_t tx_config = {};
  tx_config.size = sizeof(tx_config);
  tx_config.version = HAL_I2C_CONFIG_VERSION_1;
  tx_config.address = addr_7bit;
  tx_config.quantity = static_cast<uint32_t>(tx_buffer.size());
  tx_config.timeout_ms = timeout_ms;
  // Use repeated START (no STOP) when followed by a read phase;
  // only send STOP for write-only transactions.
  tx_config.flags = rx_buffer.empty() ? HAL_I2C_TRANSMISSION_FLAG_STOP
                                      : HAL_I2C_TRANSMISSION_FLAG_NONE;
  // HAL expects non-const buffer but only reads from tx
  tx_config.buffer =
      const_cast<uint8_t*>(reinterpret_cast<const uint8_t*>(tx_buffer.data()));

  // Build RX config (if we have data to read)
  hal_i2c_transmission_config_t rx_config = {};
  rx_config.size = sizeof(rx_config);
  rx_config.version = HAL_I2C_CONFIG_VERSION_1;
  rx_config.address = addr_7bit;
  rx_config.quantity = static_cast<uint32_t>(rx_buffer.size());
  rx_config.timeout_ms = timeout_ms;
  rx_config.flags = HAL_I2C_TRANSMISSION_FLAG_STOP;
  rx_config.buffer = reinterpret_cast<uint8_t*>(rx_buffer.data());

  // hal_i2c_transaction returns:
  //   negative: system error
  //   0: success (write-only) or read abort (0 bytes received)
  //   positive: number of bytes read (success for read transactions)
  const int result = hal_i2c_transaction(
      hal_if,
      tx_buffer.empty() ? nullptr : &tx_config,
      rx_buffer.empty() ? nullptr : &rx_config,
      nullptr);

  if (result < 0) {
    PW_LOG_WARN("I2C error: addr=0x%02x tx=%u rx=%u err=%d",
                addr_7bit, static_cast<unsigned>(tx_buffer.size()),
                static_cast<unsigned>(rx_buffer.size()), result);
    return pw::Status::Unavailable();
  }

  // For read transactions, verify we got the expected byte count.
  // result==0 when device NACKed means abort with no data received.
  if (!rx_buffer.empty() &&
      static_cast<size_t>(result) != rx_buffer.size()) {
    PW_LOG_WARN("I2C short read: addr=0x%02x expected=%u got=%d",
                addr_7bit, static_cast<unsigned>(rx_buffer.size()), result);
    return pw::Status::Unavailable();
  }

  return pw::OkStatus();
}

}  // namespace pb
