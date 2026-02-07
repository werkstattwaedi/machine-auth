// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

#include "pw_digital_io/digital_io.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

// Forward declarations for Particle types (avoid including full headers)
typedef uint16_t hal_pin_t;

namespace pb {

// Pigweed DigitalIn backend for Particle using Arduino Wiring API.
// Wraps pinMode() and digitalRead().
class ParticleDigitalIn : public pw::digital_io::DigitalIn {
 public:
  // Pin modes from Particle SDK
  enum class Mode : uint8_t {
    kInput = 0,          // INPUT
    kInputPullup = 2,    // INPUT_PULLUP
    kInputPulldown = 3,  // INPUT_PULLDOWN
  };

  ParticleDigitalIn(hal_pin_t pin, Mode mode = Mode::kInput)
      : pin_(pin), mode_(mode) {}

 private:
  pw::Status DoEnable(bool enable) override;
  pw::Result<pw::digital_io::State> DoGetState() override;

  hal_pin_t pin_;
  Mode mode_;
  bool enabled_ = false;
};

// Pigweed DigitalOut backend for Particle using Arduino Wiring API.
// Wraps pinMode() and digitalWrite().
class ParticleDigitalOut : public pw::digital_io::DigitalOut {
 public:
  explicit ParticleDigitalOut(hal_pin_t pin) : pin_(pin) {}

 private:
  pw::Status DoEnable(bool enable) override;
  pw::Status DoSetState(pw::digital_io::State state) override;

  hal_pin_t pin_;
  bool enabled_ = false;
};

// Pigweed DigitalInOut backend for Particle using Arduino Wiring API.
// Wraps pinMode(), digitalRead(), and digitalWrite().
class ParticleDigitalInOut : public pw::digital_io::DigitalInOut {
 public:
  explicit ParticleDigitalInOut(hal_pin_t pin) : pin_(pin) {}

 private:
  pw::Status DoEnable(bool enable) override;
  pw::Result<pw::digital_io::State> DoGetState() override;
  pw::Status DoSetState(pw::digital_io::State state) override;

  hal_pin_t pin_;
  bool enabled_ = false;
};

}  // namespace pb
