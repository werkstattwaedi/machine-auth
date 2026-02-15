// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/buzzer/buzzer.h"
#include "pinmap_hal.h"
#include "pw_async2/coro.h"
#include "pw_async2/system_time_provider.h"
#include "pw_status/status.h"

namespace maco::buzzer {

/// P2 hardware buzzer implementation using Device OS tone HAL.
///
/// Uses HAL_Tone_Start/Stop for PWM-driven buzzer output. Beep() is
/// fire-and-forget (the HAL manages duration via an OS timer). PlayMelody()
/// sequences notes using async waits to avoid blocking the cooperative
/// scheduler.
class ToneBuzzer : public Buzzer {
 public:
  /// Construct a tone buzzer controller.
  /// @param pin The HAL pin connected to the buzzer
  /// @param time_provider Time provider for async delays in PlayMelody
  ToneBuzzer(
      hal_pin_t pin,
      pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider);

  pw::Status Init() override;
  void Beep(uint32_t frequency_hz,
            std::chrono::milliseconds duration) override;
  void Stop() override;
  pw::async2::Coro<pw::Status> PlayMelody(
      pw::async2::CoroContext& cx, pw::span<const Note> melody) override;

 private:
  hal_pin_t pin_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;
  bool initialized_ = false;
};

}  // namespace maco::buzzer
