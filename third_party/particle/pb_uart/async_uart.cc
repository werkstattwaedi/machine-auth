// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pb_uart/async_uart.h"

#include <algorithm>

#include "delay_hal.h"
#include "pw_assert/check.h"
#include "pw_async2/waker.h"
#include "pw_log/log.h"
#include "pw_thread_particle/options.h"
#include "timer_hal.h"

namespace pb {

// ---------------------------------------------------------------------------
// ReadFuture implementation
// ---------------------------------------------------------------------------

ReadFuture::ReadFuture(AsyncUart* uart,
                       pw::ByteSpan buffer,
                       size_t min_bytes,
                       uint32_t timeout_ms)
    : uart_(uart),
      buffer_(buffer),
      min_bytes_(min_bytes),
      timeout_ms_(timeout_ms),
      start_time_ms_(HAL_Timer_Get_Milli_Seconds()) {}

ReadFuture::ReadFuture(ReadFuture&& other) noexcept
    : uart_(other.uart_),
      buffer_(other.buffer_),
      min_bytes_(other.min_bytes_),
      bytes_read_(other.bytes_read_),
      timeout_ms_(other.timeout_ms_),
      start_time_ms_(other.start_time_ms_),
      completed_(other.completed_) {
  other.uart_ = nullptr;
  other.buffer_ = {};
  other.completed_ = true;
}

ReadFuture& ReadFuture::operator=(ReadFuture&& other) noexcept {
  if (this != &other) {
    uart_ = other.uart_;
    buffer_ = other.buffer_;
    min_bytes_ = other.min_bytes_;
    bytes_read_ = other.bytes_read_;
    timeout_ms_ = other.timeout_ms_;
    start_time_ms_ = other.start_time_ms_;
    completed_ = other.completed_;

    other.uart_ = nullptr;
    other.buffer_ = {};
    other.completed_ = true;
  }
  return *this;
}

ReadFuture::~ReadFuture() = default;

pw::async2::Poll<pw::StatusWithSize> ReadFuture::Pend(pw::async2::Context& cx) {
  if (uart_ == nullptr || completed_) {
    return pw::async2::Ready(pw::StatusWithSize::InvalidArgument());
  }
  return uart_->TryRead(*this, cx);
}

// ---------------------------------------------------------------------------
// AsyncUart implementation
// ---------------------------------------------------------------------------

AsyncUart::AsyncUart(hal_usart_interface_t serial,
                     pw::ByteSpan rx_buffer,
                     pw::ByteSpan tx_buffer,
                     uint32_t poll_interval_ms)
    : serial_(serial),
      poll_interval_ms_(poll_interval_ms),
      rx_buffer_(rx_buffer),
      tx_buffer_(tx_buffer) {
  // Initialize buffers in constructor (matching Wiring's USARTSerial)
  hal_usart_buffer_config_t config = {
      .size = sizeof(hal_usart_buffer_config_t),
      .rx_buffer = reinterpret_cast<uint8_t*>(rx_buffer_.data()),
      .rx_buffer_size = static_cast<uint16_t>(rx_buffer_.size()),
      .tx_buffer = reinterpret_cast<uint8_t*>(tx_buffer_.data()),
      .tx_buffer_size = static_cast<uint16_t>(tx_buffer_.size()),
  };
  int result = hal_usart_init_ex(serial_, &config, nullptr);
  PW_ASSERT(result == 0);
}

AsyncUart::~AsyncUart() { Deinit(); }

pw::Status AsyncUart::Init(uint32_t baud_rate) {
  // Configure baud rate and start (matching Wiring's begin())
  hal_usart_begin_config(serial_, baud_rate, SERIAL_8N1, nullptr);

  // Start the background polling task
  running_.store(true, std::memory_order_release);
  thread_exited_.store(false, std::memory_order_release);

  polling_thread_ = pw::Thread(
      pw::thread::particle::Options()
          .set_name("uart_poll")
          .set_priority(3)  // Slightly above default for responsive I/O
          .set_stack_size(2048),
      [this]() { PollingTaskLoop(); });

  PW_LOG_INFO("AsyncUart initialized: baud=%lu, poll=%lums",
              static_cast<unsigned long>(baud_rate),
              static_cast<unsigned long>(poll_interval_ms_));

  return pw::OkStatus();
}

void AsyncUart::Deinit() {
  // TODO(b/async-uart): Thread shutdown doesn't work reliably.
  //
  // Root cause: FreeRTOS tasks don't enter eDeleted state until the idle task
  // cleans them up. os_thread_join() polls eTaskGetState() waiting for
  // eDeleted, but if we call join() immediately after the thread exits, the
  // idle task hasn't run yet to set eDeleted, causing an infinite loop.
  //
  // Potential fix: Call vTaskDelay(1) before joining to let idle task run.
  // However, this requires including FreeRTOS headers directly.
  //
  // For now, AsyncUart instances should be kept alive for the application
  // lifetime. See loopback_hardware_test.cc for the workaround pattern.
  //
  // Also note: After hal_usart_end(), the UART is de-configured and Init()
  // cannot be called again without re-constructing the object.

  bool was_running = running_.exchange(false, std::memory_order_acq_rel);
  if (was_running) {
    // Just stop the polling loop - don't try to join/detach
    // The thread will exit on its own but we can't wait for it
    PW_LOG_WARN("Deinit: thread cleanup skipped (known issue)");

    // Shutdown UART
    hal_usart_flush(serial_);
    hal_usart_end(serial_);
  }
}

ReadFuture AsyncUart::Read(pw::ByteSpan buffer, size_t min_bytes) {
  return ReadFuture(this, buffer, min_bytes, ReadFuture::kNoTimeout);
}

ReadFuture AsyncUart::ReadWithTimeout(pw::ByteSpan buffer,
                                      size_t min_bytes,
                                      uint32_t timeout_ms) {
  return ReadFuture(this, buffer, min_bytes, timeout_ms);
}

pw::Status AsyncUart::Write(pw::ConstByteSpan data) {
  // Check if there's enough space in TX buffer (non-blocking write)
  int32_t available = hal_usart_available_data_for_write(serial_);
  if (available < 0 || static_cast<size_t>(available) < data.size()) {
    // Not enough space - caller should retry or handle error
    return pw::Status::ResourceExhausted();
  }

  for (auto b : data) {
    hal_usart_write(serial_, static_cast<uint8_t>(b));
  }
  // Don't flush - let TX buffer drain asynchronously
  return pw::OkStatus();
}

void AsyncUart::Drain() {
  // Single-pass drain - read all currently available bytes.
  // If caller needs to catch in-flight bytes, they should use async delays.
  while (hal_usart_available(serial_) > 0) {
    (void)hal_usart_read(serial_);
  }
}

void AsyncUart::PollingTaskLoop() {
  PW_LOG_INFO("PollingTaskLoop: started");
  uint32_t polls_since_wake = 0;
  constexpr uint32_t kWakeIntervalPolls = 10;  // Wake every 10 polls for timeout checks

  while (running_.load(std::memory_order_acquire)) {
    // Check if data is available
    int32_t available = hal_usart_available(serial_);

    // Wake the pending future if:
    // 1. Data is available, OR
    // 2. Enough polls have passed (to allow timeout checking)
    bool should_wake_for_timeout = (++polls_since_wake >= kWakeIntervalPolls);

    if (available > 0 || should_wake_for_timeout) {
      // Copy waker under lock, then wake outside lock to avoid deadlock.
      // Wake() acquires internal pw_async2 locks, so we must not hold our
      // spinlock while calling it.
      pw::async2::Waker waker_copy;
      bool should_wake = false;
      {
        std::lock_guard lock(lock_);
        if (has_pending_waker_) {
          waker_copy = std::move(pending_waker_);
          has_pending_waker_ = false;
          should_wake = true;
        }
      }
      if (should_wake) {
        waker_copy.Wake();
        polls_since_wake = 0;
      }
    }

    // Sleep for the poll interval
    HAL_Delay_Milliseconds(poll_interval_ms_);
  }
  PW_LOG_INFO("PollingTaskLoop: exiting");
  thread_exited_.store(true, std::memory_order_release);
}

pw::async2::Poll<pw::StatusWithSize> AsyncUart::TryRead(
    ReadFuture& future, pw::async2::Context& cx) {
  // Check available data
  int32_t available = hal_usart_available(serial_);

  // Read whatever is available, up to buffer size
  if (available > 0) {
    size_t remaining_space = future.buffer_.size() - future.bytes_read_;
    size_t to_read =
        std::min(remaining_space, static_cast<size_t>(available));

    for (size_t i = 0; i < to_read; ++i) {
      int32_t byte = hal_usart_read(serial_);
      if (byte < 0) {
        // Unexpected - HAL said bytes were available
        PW_LOG_WARN("TryRead: hal_usart_read returned %d",
                    static_cast<int>(byte));
        break;
      }
      future.buffer_[future.bytes_read_++] = static_cast<std::byte>(byte);
    }
  }

  // Check if we have enough data
  if (future.bytes_read_ >= future.min_bytes_) {
    future.completed_ = true;
    // Clear pending waker since we're done
    {
      std::lock_guard lock(lock_);
      has_pending_waker_ = false;
    }
    return pw::async2::Ready(pw::StatusWithSize(future.bytes_read_));
  }

  // Check for timeout (if configured)
  if (future.timeout_ms_ != ReadFuture::kNoTimeout) {
    uint32_t elapsed = HAL_Timer_Get_Milli_Seconds() - future.start_time_ms_;
    if (elapsed >= future.timeout_ms_) {
      future.completed_ = true;
      // Clear pending waker since we're done
      {
        std::lock_guard lock(lock_);
        has_pending_waker_ = false;
      }
      return pw::async2::Ready(pw::StatusWithSize::DeadlineExceeded());
    }
  }

  // Not enough data yet - store waker for background task to wake us
  {
    std::lock_guard lock(lock_);
    // Use TRY variant to detect concurrent reads (only one allowed at a time)
    if (!PW_ASYNC_TRY_STORE_WAKER(cx, pending_waker_, "Waiting for UART data")) {
      // Another read is already pending - this is a usage error
      PW_LOG_ERROR("TryRead: concurrent read detected (only one allowed)");
      future.completed_ = true;
      return pw::async2::Ready(pw::StatusWithSize::FailedPrecondition());
    }
    has_pending_waker_ = true;
  }

  return pw::async2::Pending();
}

}  // namespace pb
