// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <chrono>
#include <cstdint>

#include "pw_async2/coro.h"
#include "pw_span/span.h"
#include "pw_status/status.h"

namespace maco::buzzer {

/// A single note in a melody sequence.
struct Note {
  uint32_t frequency_hz;               // 0 = rest/silence
  std::chrono::milliseconds duration;
};

/// Controls a PWM buzzer for audio feedback.
///
/// Implementations handle the specific buzzer hardware. The buzzer produces
/// simple tones at configurable frequencies and durations.
///
/// Typical usage (within a coroutine):
/// @code
///   auto& buzzer = maco::system::GetBuzzer();
///   buzzer.Init();
///
///   // Single beep (fire-and-forget)
///   buzzer.Beep(2000, 200ms);
///
///   // Play a melody
///   constexpr Note melody[] = {
///       {2000, 200ms}, {0, 100ms}, {3000, 200ms},
///   };
///   co_await buzzer.PlayMelody(cx, melody);
/// @endcode
class Buzzer {
 public:
  virtual ~Buzzer() = default;

  /// Initialize the buzzer hardware.
  /// @return OkStatus on success, error otherwise
  virtual pw::Status Init() = 0;

  /// Play a single tone. Fire-and-forget: the HAL manages the duration.
  /// @param frequency_hz Tone frequency in Hz
  /// @param duration How long to play
  virtual void Beep(uint32_t frequency_hz,
                    std::chrono::milliseconds duration) = 0;

  /// Stop any currently playing tone.
  virtual void Stop() = 0;

  /// Play a sequence of notes asynchronously.
  /// @param cx Coroutine context for suspension
  /// @param melody Span of notes to play in order
  /// @return OkStatus on success, error otherwise
  virtual pw::async2::Coro<pw::Status> PlayMelody(
      pw::async2::CoroContext& cx, pw::span<const Note> melody) = 0;
};

}  // namespace maco::buzzer
