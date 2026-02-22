// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <chrono>

#include "maco_firmware/modules/led/led_frame_renderer.h"
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

  /// Register a frame renderer. Must be set before Init() to avoid races.
  /// The renderer's OnFrame() is called once per frame before Show().
  void set_frame_renderer(LedFrameRenderer* renderer) {
    renderer_ = renderer;
  }

  /// Direct access to driver for setting pixels.
  ///
  /// Note: No synchronization. Pixel changes may be partially visible
  /// if modified during Show(). For smooth animations, batch all
  /// pixel changes before the next frame.
  Driver& driver() { return driver_; }
  const Driver& driver() const { return driver_; }

 private:
  // Maximum dt passed to renderer; caps first-frame jitter at startup.
  static constexpr float kMaxDt =
      std::chrono::duration<float>(2 * kFramePeriod).count();

  void RenderThread() {
    auto next_frame = pw::chrono::SystemClock::now();
    auto last_frame = next_frame;

    while (running_.load(std::memory_order_relaxed)) {
      next_frame += kFramePeriod;

      auto now = pw::chrono::SystemClock::now();
      float dt_s = std::chrono::duration<float>(now - last_frame).count();
      if (dt_s > kMaxDt) dt_s = kMaxDt;
      last_frame = now;

      // Let the renderer update pixel state before we push it.
      if (renderer_ != nullptr) renderer_->OnFrame(dt_s);

      // Push current pixel state to hardware
      if (pw::Status status = driver_.Show(); !status.ok()) {
        PW_LOG_WARN("LED Show() failed: %s", pw_StatusString(status));
      }

      // Sleep until next frame (prevents drift)
      pw::this_thread::sleep_until(next_frame);
    }
  }

  Driver& driver_;
  LedFrameRenderer* renderer_ = nullptr;
  std::atomic<bool> running_{true};
};

}  // namespace maco::led
