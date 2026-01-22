// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <chrono>

#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"
#include "pw_status/status.h"
#include "pw_status/try.h"
#include "pw_thread/detached_thread.h"
#include "pw_thread/options.h"
#include "pw_thread/sleep.h"

namespace maco::led {

/// LED module with high-priority render thread for animations.
/// Guarantees 30fps refresh rate for smooth animations.
///
/// @tparam Driver The concrete LED driver type (CRTP-based LedDriver).
template <typename Driver>
class Led {
 public:
  static constexpr uint16_t kLedCount = Driver::kLedCount;
  static constexpr auto kFramePeriod = std::chrono::milliseconds(33);  // ~30fps

  explicit Led(Driver& driver) : driver_(driver) {}

  /// Initialize driver and start render thread.
  /// @param thread_options Platform-specific thread options for render thread.
  pw::Status Init(const pw::thread::Options& thread_options) {
    PW_TRY(driver_.Init());

    pw::thread::DetachedThread(thread_options, [this] { RenderThread(); });

    PW_LOG_INFO("LED module initialized with %u LEDs", kLedCount);
    return pw::OkStatus();
  }

  /// Direct access to driver for setting pixels.
  ///
  /// Note: No synchronization. Pixel changes may be partially visible
  /// if modified during Show(). For smooth animations, batch all
  /// pixel changes before the next frame.
  Driver& driver() { return driver_; }
  const Driver& driver() const { return driver_; }

 private:
  void RenderThread() {
    auto next_frame = pw::chrono::SystemClock::now();

    while (running_.load(std::memory_order_relaxed)) {
      next_frame += kFramePeriod;

      // Push current pixel state to hardware
      if (pw::Status status = driver_.Show(); !status.ok()) {
        PW_LOG_WARN("LED Show() failed: %s", pw_StatusString(status));
      }

      // Sleep until next frame (prevents drift)
      pw::this_thread::sleep_until(next_frame);
    }
  }

  Driver& driver_;
  std::atomic<bool> running_{true};
};

}  // namespace maco::led
