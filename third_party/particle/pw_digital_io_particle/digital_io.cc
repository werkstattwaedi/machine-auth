// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pb_digital_io/digital_io.h"

#include "gpio_hal.h"
#include "pw_assert/check.h"

namespace pb {

using ::pw::digital_io::State;

// ParticleDigitalIn implementation

pw::Status ParticleDigitalIn::DoEnable(bool enable) {
  PW_CHECK(pin_ < 100, "UNIQUE_STRING_PARTICLE_GPIO_PIN_OUT_OF_RANGE");
  if (enable && !enabled_) {
    hal_gpio_mode(pin_, static_cast<PinMode>(mode_));
    enabled_ = true;
  } else if (!enable) {
    enabled_ = false;
  }
  return pw::OkStatus();
}

pw::Result<State> ParticleDigitalIn::DoGetState() {
  if (!enabled_) {
    return pw::Status::FailedPrecondition();
  }
  const int32_t value = hal_gpio_read(pin_);
  return value != 0 ? State::kActive : State::kInactive;
}

// ParticleDigitalOut implementation

pw::Status ParticleDigitalOut::DoEnable(bool enable) {
  if (enable && !enabled_) {
    hal_gpio_mode(pin_, OUTPUT);
    enabled_ = true;
  } else if (!enable) {
    enabled_ = false;
  }
  return pw::OkStatus();
}

pw::Status ParticleDigitalOut::DoSetState(State state) {
  if (!enabled_) {
    return pw::Status::FailedPrecondition();
  }
  hal_gpio_write(pin_, state == State::kActive ? 1 : 0);
  return pw::OkStatus();
}

// ParticleDigitalInOut implementation

pw::Status ParticleDigitalInOut::DoEnable(bool enable) {
  if (enable && !enabled_) {
    hal_gpio_mode(pin_, OUTPUT);
    enabled_ = true;
  } else if (!enable) {
    enabled_ = false;
  }
  return pw::OkStatus();
}

pw::Result<State> ParticleDigitalInOut::DoGetState() {
  if (!enabled_) {
    return pw::Status::FailedPrecondition();
  }
  const int32_t value = hal_gpio_read(pin_);
  return value != 0 ? State::kActive : State::kInactive;
}

pw::Status ParticleDigitalInOut::DoSetState(State state) {
  if (!enabled_) {
    return pw::Status::FailedPrecondition();
  }
  hal_gpio_write(pin_, state == State::kActive ? 1 : 0);
  return pw::OkStatus();
}

}  // namespace pb
