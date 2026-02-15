// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "buzzer"

#include "maco_firmware/modules/buzzer/tone_buzzer.h"

#include "pw_log/log.h"
#include "tone_hal.h"

namespace maco::buzzer {

ToneBuzzer::ToneBuzzer(
    hal_pin_t pin,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider)
    : pin_(pin), time_provider_(time_provider) {}

pw::Status ToneBuzzer::Init() {
  initialized_ = true;
  PW_LOG_DEBUG("Buzzer initialized on pin %d", static_cast<int>(pin_));
  return pw::OkStatus();
}

void ToneBuzzer::Beep(uint32_t frequency_hz,
                      std::chrono::milliseconds duration) {
  if (!initialized_) {
    PW_LOG_ERROR("Buzzer not initialized");
    return;
  }
  HAL_Tone_Start(pin_, frequency_hz, static_cast<uint32_t>(duration.count()));
}

void ToneBuzzer::Stop() {
  HAL_Tone_Stop(pin_);
}

pw::async2::Coro<pw::Status> ToneBuzzer::PlayMelody(
    [[maybe_unused]] pw::async2::CoroContext& cx,
    pw::span<const Note> melody) {
  if (!initialized_) {
    PW_LOG_ERROR("Buzzer not initialized");
    co_return pw::Status::FailedPrecondition();
  }

  for (const auto& note : melody) {
    if (note.frequency_hz == 0) {
      HAL_Tone_Stop(pin_);
    } else {
      HAL_Tone_Start(
          pin_, note.frequency_hz,
          static_cast<uint32_t>(note.duration.count()));
    }
    co_await time_provider_.WaitFor(note.duration);
  }

  HAL_Tone_Stop(pin_);
  co_return pw::OkStatus();
}

}  // namespace maco::buzzer
