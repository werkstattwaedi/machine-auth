// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pw_chrono/system_timer.h"

#include <algorithm>

#include "concurrent_hal.h"
#include "pw_assert/check.h"

namespace pw::chrono {
namespace {

using State = backend::NativeSystemTimer::State;

// Maximum timer period in milliseconds (leave room for safety).
constexpr unsigned kMaxPeriodMs = CONCURRENT_WAIT_FOREVER - 1;

void HandleTimerCallback(os_timer_t timer) {
  void* timer_id = nullptr;
  os_timer_get_id(timer, &timer_id);
  if (timer_id == nullptr) {
    return;
  }

  backend::NativeSystemTimer* native_type =
      static_cast<backend::NativeSystemTimer*>(timer_id);

  // Check if cancelled.
  if (native_type->state == State::kCancelled) {
    return;
  }

  const SystemClock::duration time_until_deadline =
      native_type->expiry_deadline - SystemClock::now();

  if (time_until_deadline <= SystemClock::duration::zero()) {
    // Deadline reached, cancel and invoke callback.
    native_type->state = State::kCancelled;
    native_type->user_callback(native_type->expiry_deadline);
  } else {
    // Not yet at deadline, reschedule.
    const int64_t remaining_ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            time_until_deadline)
            .count();
    const unsigned period_ms =
        static_cast<unsigned>(std::min(static_cast<int64_t>(kMaxPeriodMs),
                                       std::max(static_cast<int64_t>(1),
                                                remaining_ms)));
    os_timer_change(native_type->timer, OS_TIMER_CHANGE_PERIOD, false,
                    period_ms, 0, nullptr);
    os_timer_change(native_type->timer, OS_TIMER_CHANGE_START, false,
                    0, 0, nullptr);
  }
}

}  // namespace

SystemTimer::SystemTimer(ExpiryCallback&& callback)
    : native_type_{.timer = nullptr,
                   .state = State::kCancelled,
                   .expiry_deadline = SystemClock::time_point(),
                   .user_callback = std::move(callback)} {
  // Create a one-shot timer with an initial period of 1ms.
  // We'll change the period when scheduling.
  int result = os_timer_create(&native_type_.timer, 1, HandleTimerCallback,
                               &native_type_, true, nullptr);
  PW_CHECK_INT_EQ(result, 0, "Failed to create timer");
}

SystemTimer::~SystemTimer() {
  Cancel();

  if (native_type_.timer != nullptr) {
    // Wait for timer to be inactive before destroying.
    while (os_timer_is_active(native_type_.timer, nullptr)) {
      os_thread_yield();
    }
    os_timer_destroy(native_type_.timer, nullptr);
    native_type_.timer = nullptr;
  }
}

void SystemTimer::InvokeAt(SystemClock::time_point timestamp) {
  native_type_.expiry_deadline = timestamp;

  const SystemClock::duration time_until_deadline =
      timestamp - SystemClock::now();
  const int64_t delay_ms =
      std::chrono::duration_cast<std::chrono::milliseconds>(time_until_deadline)
          .count();

  // Calculate period, clamping to valid range (minimum 1ms).
  const unsigned period_ms =
      static_cast<unsigned>(std::min(static_cast<int64_t>(kMaxPeriodMs),
                                     std::max(static_cast<int64_t>(1),
                                              delay_ms)));

  // Update timer period and start.
  os_timer_change(native_type_.timer, OS_TIMER_CHANGE_PERIOD, false,
                  period_ms, 0, nullptr);

  if (native_type_.state == State::kCancelled) {
    os_timer_change(native_type_.timer, OS_TIMER_CHANGE_START, false,
                    0, 0, nullptr);
    native_type_.state = State::kScheduled;
  }
}

void SystemTimer::Cancel() {
  native_type_.state = State::kCancelled;
  if (native_type_.timer != nullptr) {
    os_timer_change(native_type_.timer, OS_TIMER_CHANGE_STOP, false,
                    0, 0, nullptr);
  }
}

}  // namespace pw::chrono
