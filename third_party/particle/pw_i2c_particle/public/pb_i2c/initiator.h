// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

#include "pw_i2c/initiator.h"
#include "pw_status/status.h"

namespace pb {

/// Pigweed I2C Initiator backend for Particle using HAL I2C API.
/// Wraps hal_i2c_* functions from i2c_hal.h.
///
/// I2C transactions are synchronous (no DMA), so no semaphore is needed.
/// Thread safety is handled internally by the HAL's mutex.
class ParticleI2cInitiator : public pw::i2c::Initiator {
 public:
  /// I2C interface selection (maps to HAL_I2C_INTERFACE1/2)
  enum class Interface : uint8_t {
    kWire = 0,   // HAL_I2C_INTERFACE1 (default I2C pins)
    kWire1 = 1,  // HAL_I2C_INTERFACE2
  };

  /// Constructor.
  /// @param interface The I2C interface to use
  /// @param clock_hz Target clock frequency (e.g., 100000 or 400000)
  explicit ParticleI2cInitiator(Interface interface, uint32_t clock_hz);

  ~ParticleI2cInitiator() override;

  // Non-copyable, non-movable
  ParticleI2cInitiator(const ParticleI2cInitiator&) = delete;
  ParticleI2cInitiator& operator=(const ParticleI2cInitiator&) = delete;
  ParticleI2cInitiator(ParticleI2cInitiator&&) = delete;
  ParticleI2cInitiator& operator=(ParticleI2cInitiator&&) = delete;

 private:
  pw::Status DoWriteReadFor(
      pw::i2c::Address device_address,
      pw::ConstByteSpan tx_buffer,
      pw::ByteSpan rx_buffer,
      pw::chrono::SystemClock::duration timeout) override;

  void LazyInit();

  Interface interface_;
  uint32_t clock_hz_;
  bool initialized_ = false;
};

}  // namespace pb
