// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>

#include "pw_async2/context.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/poll.h"
#include "pw_async2/waker.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"
#include "pw_status/status.h"
#include "pw_status/status_with_size.h"
#include "pw_sync/mutex.h"
#include "pw_thread/thread.h"
#include "usart_hal.h"

namespace pb {

class AsyncUart;

/// Future returned by AsyncUart::Read().
///
/// This future completes when at least `min_bytes` are available in the UART
/// receive buffer, or when the optional timeout expires. The background polling
/// task wakes the future when data arrives.
class ReadFuture {
 public:
  using value_type = pw::StatusWithSize;

  /// No timeout (wait indefinitely)
  static constexpr uint32_t kNoTimeout = 0;

  ReadFuture() = default;
  ReadFuture(ReadFuture&& other) noexcept;
  ReadFuture& operator=(ReadFuture&& other) noexcept;
  ~ReadFuture();

  ReadFuture(const ReadFuture&) = delete;
  ReadFuture& operator=(const ReadFuture&) = delete;

  /// Polls the future to check if enough data is available.
  /// Returns DeadlineExceeded if timeout expires before enough data arrives.
  pw::async2::Poll<pw::StatusWithSize> Pend(pw::async2::Context& cx);

  /// Returns true if the future has completed (data was read or error).
  [[nodiscard]] bool is_complete() const { return completed_; }

 private:
  friend class AsyncUart;

  /// Private constructor used by AsyncUart.
  ReadFuture(AsyncUart* uart,
             pw::ByteSpan buffer,
             size_t min_bytes,
             uint32_t timeout_ms);

  AsyncUart* uart_ = nullptr;
  pw::ByteSpan buffer_;
  size_t min_bytes_ = 0;
  size_t bytes_read_ = 0;
  uint32_t timeout_ms_ = kNoTimeout;
  uint32_t start_time_ms_ = 0;
  bool completed_ = false;
};

/// Async UART implementation with waker support for C++20 coroutines.
///
/// This class provides true async I/O by using a background FreeRTOS task
/// that polls the UART and wakes pending futures when data arrives. This
/// allows coroutines to suspend and be resumed when data is available,
/// rather than busy-waiting.
///
/// Usage:
/// @code
///   // Caller provides buffers - must be 32-byte aligned for DMA on RTL872x
///   alignas(32) static uint8_t rx_buf[265];  // PN532 max frame ~265 bytes
///   alignas(32) static uint8_t tx_buf[265];
///   AsyncUart uart(HAL_USART_SERIAL2, pw::ByteSpan(rx_buf), pw::ByteSpan(tx_buf));
///   PW_TRY(uart.Init(115200));
///
///   // In a coroutine:
///   std::array<std::byte, 64> buffer;
///   auto result = co_await uart.Read(buffer, 4);  // Wait for 4 bytes
///   PW_TRY(result.status());
/// @endcode
class AsyncUart {
 public:
  /// Construct an async UART wrapper with caller-provided buffers.
  ///
  /// @param serial HAL UART interface (e.g., HAL_USART_SERIAL2)
  /// @param rx_buffer Receive buffer (must be 32-byte aligned for DMA)
  /// @param tx_buffer Transmit buffer (must be 32-byte aligned for DMA)
  /// @param poll_interval_ms How often to check for data (default 1ms)
  ///
  /// @note Buffers must remain valid for the lifetime of the AsyncUart.
  ///       Size should match the largest expected frame (e.g., 265 for PN532).
  AsyncUart(hal_usart_interface_t serial,
            pw::ByteSpan rx_buffer,
            pw::ByteSpan tx_buffer,
            uint32_t poll_interval_ms = 1);

  ~AsyncUart();

  AsyncUart(const AsyncUart&) = delete;
  AsyncUart& operator=(const AsyncUart&) = delete;
  AsyncUart(AsyncUart&&) = delete;
  AsyncUart& operator=(AsyncUart&&) = delete;

  /// Initialize the UART with specified baud rate and start background task.
  /// @param baud_rate Baud rate (default 115200 for PN532)
  /// @return OkStatus on success
  pw::Status Init(uint32_t baud_rate = 115200);

  /// Shutdown the UART and stop background task.
  ///
  /// @warning Thread cleanup is unreliable on Particle P2. After Deinit(),
  ///          the instance cannot be re-initialized. Prefer keeping instances
  ///          alive for the application lifetime.
  void Deinit();

  /// Start an async read operation.
  ///
  /// Returns a future that completes when at least `min_bytes` are available.
  /// The data is read into `buffer`.
  ///
  /// @pre Only one read operation may be pending at a time. Calling Read()
  ///      while another read is in progress will fail.
  /// @pre The buffer must remain valid until the future completes.
  ///
  /// @param buffer Buffer to read into
  /// @param min_bytes Minimum bytes to wait for (default 1)
  /// @return A future that completes with StatusWithSize
  ReadFuture Read(pw::ByteSpan buffer, size_t min_bytes = 1);

  /// Start an async read operation with timeout.
  ///
  /// Same as Read(), but returns DeadlineExceeded if the timeout expires
  /// before `min_bytes` are received. Any partially received bytes are
  /// discarded on timeout.
  ///
  /// @param buffer Buffer to read into
  /// @param min_bytes Minimum bytes to wait for
  /// @param timeout_ms Timeout in milliseconds
  /// @return A future that completes with StatusWithSize or DeadlineExceeded
  ReadFuture ReadWithTimeout(pw::ByteSpan buffer,
                             size_t min_bytes,
                             uint32_t timeout_ms);

  /// Synchronous write (TX is already fast via HAL ring buffer).
  /// @param data Data to write
  /// @return OkStatus on success, ResourceExhausted if TX buffer full
  pw::Status Write(pw::ConstByteSpan data);

  /// Discard all currently pending receive data (single pass, non-blocking).
  ///
  /// Reads and discards all bytes currently in the HAL receive buffer.
  /// Does not wait for in-flight bytes - if needed, the caller should
  /// use async delays between multiple Drain() calls.
  ///
  /// @warning Do not call while a Read/ReadWithTimeout future is pending.
  void Drain();

 private:
  friend class ReadFuture;

  /// Background FreeRTOS task that polls hal_usart_available().
  void PollingTaskLoop();

  /// Called by ReadFuture::Pend to attempt reading data.
  /// @return Ready with bytes read, or Pending if not enough data yet
  pw::async2::Poll<pw::StatusWithSize> TryRead(ReadFuture& future,
                                               pw::async2::Context& cx);

  hal_usart_interface_t serial_;
  uint32_t poll_interval_ms_;

  // Caller-provided buffers (must be 32-byte aligned for RTL872x DMA)
  pw::ByteSpan rx_buffer_;
  pw::ByteSpan tx_buffer_;

  // Background polling task
  std::atomic<bool> running_{false};
  std::atomic<bool> thread_exited_{true};  // Starts as true (no thread running)
  pw::Thread polling_thread_;

  // Pending read waker - protected by mutex
  // When a read is pending, we store the waker here so the polling task
  // can wake the coroutine when data arrives.
  pw::sync::Mutex lock_;
  pw::async2::Waker pending_waker_;
  bool has_pending_waker_ = false;
};

}  // namespace pb
