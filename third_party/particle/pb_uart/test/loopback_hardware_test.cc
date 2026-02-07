// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Hardware loopback test for AsyncUart with C++20 coroutines.
//
// WIRING REQUIRED (for SERIAL2):
//   D4 (TX) -> D5 (RX)
//
// This creates a loopback on a single UART to verify async read/write
// functionality with waker support.

#include "pb_uart/async_uart.h"

#include <cstring>

#include "delay_hal.h"
#include "usart_hal.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/system_time_provider.h"
#include "pw_bytes/array.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"
#include "pw_unit_test/framework.h"

using namespace std::chrono_literals;

namespace {

constexpr uint32_t kBaudRate = 115200;

// Test pattern - recognizable bytes
constexpr auto kTestPattern =
    pw::bytes::Array<0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03, 0x04>();

// Allocator for coroutine frames
pw::allocator::test::AllocatorForTest<4096> test_allocator;

// Single UART instance shared across all tests.
// We cannot use per-test Init/Deinit because Deinit hangs (see async_uart.cc).
pb::AsyncUart& GetUart() {
  // UART buffers (128 bytes is plenty for loopback tests)
  // Must be 32-byte aligned for DMA on RTL872x
  alignas(32) static std::byte rx_buf[128];
  alignas(32) static std::byte tx_buf[128];
  static pb::AsyncUart uart(HAL_USART_SERIAL2, rx_buf, tx_buf);
  static bool initialized = false;
  if (!initialized) {
    auto status = uart.Init(kBaudRate);
    PW_ASSERT(status.ok());
    initialized = true;
    PW_LOG_INFO("UART initialized (shared instance)");
  }
  return uart;
}

class AsyncUartLoopbackTest : public ::testing::Test {
 protected:
  void SetUp() override {
    PW_LOG_INFO("=== Test SetUp ===");
    PW_LOG_INFO("Wiring: D4 (TX) -> D5 (RX) for SERIAL2 loopback");
    // Drain any leftover data from previous tests
    while (hal_usart_available(HAL_USART_SERIAL2) > 0) {
      hal_usart_read(HAL_USART_SERIAL2);
    }
  }

  void TearDown() override {
    PW_LOG_INFO("=== Test TearDown ===");
    // Note: We don't call Deinit - see GetUart() comment
  }

  pw::async2::BasicDispatcher dispatcher_;
};

// Test 1: Basic write (should not block)
TEST_F(AsyncUartLoopbackTest, SyncWrite) {
  auto& uart = GetUart();

  PW_LOG_INFO("Testing: Synchronous write");

  auto status = uart.Write(kTestPattern);
  ASSERT_TRUE(status.ok()) << "Write failed";

  PW_LOG_INFO("Write completed successfully");

  // Wait a bit for data to loop back, then drain
  HAL_Delay_Milliseconds(10);
}

// Test 2: Async read with coroutine - the main test
TEST_F(AsyncUartLoopbackTest, AsyncReadWithCoroutine) {
  auto& uart = GetUart();

  PW_LOG_INFO("Testing: Async read with C++20 coroutine");

  bool test_passed = false;

  // Define the test coroutine
  auto test_coro = [&](pw::async2::CoroContext&) -> pw::async2::Coro<pw::Status> {
    // Write test pattern
    PW_LOG_INFO("Coro: Writing %u bytes", static_cast<unsigned>(kTestPattern.size()));
    auto write_status = uart.Write(kTestPattern);
    if (!write_status.ok()) {
      PW_LOG_ERROR("Coro: Write failed");
      co_return write_status;
    }

    // Small delay for loopback
    HAL_Delay_Milliseconds(5);

    // Async read - should wake when data arrives
    std::array<std::byte, 16> rx_buffer{};
    PW_LOG_INFO("Coro: Starting async read for %u bytes",
                static_cast<unsigned>(kTestPattern.size()));

    auto read_future = uart.Read(rx_buffer, kTestPattern.size());
    auto result = co_await read_future;

    if (!result.ok()) {
      PW_LOG_ERROR("Coro: Read failed with status %d",
                   static_cast<int>(result.status().code()));
      co_return result.status();
    }

    PW_LOG_INFO("Coro: Read %u bytes", static_cast<unsigned>(result.size()));

    // Verify data
    if (result.size() != kTestPattern.size()) {
      PW_LOG_ERROR("Coro: Size mismatch: got %u, expected %u",
                   static_cast<unsigned>(result.size()),
                   static_cast<unsigned>(kTestPattern.size()));
      co_return pw::Status::DataLoss();
    }

    for (size_t i = 0; i < kTestPattern.size(); ++i) {
      if (rx_buffer[i] != kTestPattern[i]) {
        PW_LOG_ERROR("Coro: Data mismatch at byte %u: got 0x%02X, expected 0x%02X",
                     static_cast<unsigned>(i),
                     static_cast<unsigned>(static_cast<uint8_t>(rx_buffer[i])),
                     static_cast<unsigned>(static_cast<uint8_t>(kTestPattern[i])));
        co_return pw::Status::DataLoss();
      }
    }

    test_passed = true;
    PW_LOG_INFO("Coro: Loopback verified successfully!");
    co_return pw::OkStatus();
  };

  // Create coroutine context with allocator
  pw::async2::CoroContext coro_cx(test_allocator);
  auto coro = test_coro(coro_cx);

  pw::async2::CoroOrElseTask task(
      std::move(coro), [](pw::Status status) {
        if (!status.ok()) {
          PW_LOG_ERROR("Coroutine failed with status %d",
                       static_cast<int>(status.code()));
        }
      });

  dispatcher_.Post(task);

  // Run dispatcher until task completes (with timeout)
  int iterations = 0;
  constexpr int kMaxIterations = 1000;  // ~1 second with 1ms polls

  while (task.IsRegistered() && iterations++ < kMaxIterations) {
    dispatcher_.RunUntilStalled();
    HAL_Delay_Milliseconds(1);
  }

  ASSERT_LT(iterations, kMaxIterations) << "Test timed out";
  ASSERT_TRUE(test_passed) << "Coroutine test failed";

  PW_LOG_INFO("Async read with coroutine: PASSED");
}

// Test 3: Multiple sequential reads
TEST_F(AsyncUartLoopbackTest, MultipleSequentialReads) {
  auto& uart = GetUart();

  PW_LOG_INFO("Testing: Multiple sequential async reads");

  int successful_reads = 0;

  auto test_coro = [&](pw::async2::CoroContext&) -> pw::async2::Coro<pw::Status> {
    for (int i = 0; i < 3; ++i) {
      // Write a small pattern
      constexpr auto kSmallPattern = pw::bytes::Array<0xAA, 0xBB>();
      uart.Write(kSmallPattern);
      HAL_Delay_Milliseconds(5);

      // Async read
      std::array<std::byte, 4> rx_buffer{};
      auto result = co_await uart.Read(rx_buffer, kSmallPattern.size());

      if (!result.ok() || result.size() != kSmallPattern.size()) {
        PW_LOG_ERROR("Sequential read %d failed", i);
        co_return pw::Status::Internal();
      }

      if (rx_buffer[0] != kSmallPattern[0] || rx_buffer[1] != kSmallPattern[1]) {
        PW_LOG_ERROR("Sequential read %d data mismatch", i);
        co_return pw::Status::DataLoss();
      }

      successful_reads++;
      PW_LOG_INFO("Sequential read %d: OK", i);
    }

    co_return pw::OkStatus();
  };

  pw::async2::CoroContext coro_cx(test_allocator);
  auto coro = test_coro(coro_cx);

  pw::async2::CoroOrElseTask task(
      std::move(coro), [](pw::Status status) {
        if (!status.ok()) {
          PW_LOG_ERROR("Sequential test failed: %d",
                       static_cast<int>(status.code()));
        }
      });

  dispatcher_.Post(task);

  int iterations = 0;
  constexpr int kMaxIterations = 2000;

  while (task.IsRegistered() && iterations++ < kMaxIterations) {
    dispatcher_.RunUntilStalled();
    HAL_Delay_Milliseconds(1);
  }

  ASSERT_LT(iterations, kMaxIterations) << "Test timed out";
  ASSERT_EQ(successful_reads, 3) << "Not all reads succeeded";

  PW_LOG_INFO("Multiple sequential reads: PASSED");
}

// Test 4: Interleaved reads and writes with two concurrent coroutines
//
// This test demonstrates async I/O interleaving:
// - Reader coroutine: 3 reads of 6 bytes each (18 bytes total)
// - Writer coroutine: writes 8, 1, 5, 4 bytes with delays (18 bytes total)
//
// The reader starts first and suspends waiting for data. The writer then
// sends data in batches, and we observe how the reads complete as data arrives.
//
// Expected interleaving (reads complete as data becomes available):
//   W1(8) -> R0(6) -> W2(1) -> W3(5) -> R1(6) -> W4(4) -> R2(6)
TEST_F(AsyncUartLoopbackTest, InterleavedReadsAndWrites) {
  auto& uart = GetUart();

  PW_LOG_INFO("Testing: Interleaved reads/writes with two coroutines");
  PW_LOG_INFO("  Reader: 3 reads of 6 bytes each");
  PW_LOG_INFO("  Writer: writes of 8, 1, 5, 4 bytes with delays");

  // Test data - 18 bytes total with recognizable pattern
  constexpr auto kTestData = pw::bytes::Array<
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06,  // Read 1 should get these
      0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C,  // Read 2 should get these
      0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12   // Read 3 should get these
      >();

  // Event tracking for order verification
  enum class Event : uint8_t {
    kWrite1 = 0,  // W1: 8 bytes
    kWrite2 = 1,  // W2: 1 byte
    kWrite3 = 2,  // W3: 5 bytes
    kWrite4 = 3,  // W4: 4 bytes
    kRead0 = 4,   // R0: 6 bytes
    kRead1 = 5,   // R1: 6 bytes
    kRead2 = 6,   // R2: 6 bytes
  };
  std::array<Event, 7> events{};
  size_t event_count = 0;

  bool reader_done = false;
  bool writer_done = false;
  std::array<std::byte, 18> received_data{};

  // Reader coroutine - starts first, does 3 reads of 6 bytes
  auto reader_coro = [&](pw::async2::CoroContext&) -> pw::async2::Coro<pw::Status> {
    PW_LOG_INFO("[Reader] Starting - will do 3 reads of 6 bytes each");

    for (int i = 0; i < 3; ++i) {
      PW_LOG_INFO("[Reader] Read %d: waiting for 6 bytes...", i);

      std::array<std::byte, 6> rx_buffer{};
      auto result = co_await uart.Read(rx_buffer, 6);

      if (!result.ok()) {
        PW_LOG_ERROR("[Reader] Read %d failed: %d", i,
                     static_cast<int>(result.status().code()));
        co_return result.status();
      }

      // Record event
      events[event_count++] = static_cast<Event>(static_cast<uint8_t>(Event::kRead0) + i);

      // Copy to received_data for verification
      std::memcpy(&received_data[i * 6], rx_buffer.data(), 6);

      PW_LOG_INFO("[Reader] Read %d: got %u bytes [%02X %02X %02X %02X %02X %02X]",
                  i, static_cast<unsigned>(result.size()),
                  static_cast<uint8_t>(rx_buffer[0]),
                  static_cast<uint8_t>(rx_buffer[1]),
                  static_cast<uint8_t>(rx_buffer[2]),
                  static_cast<uint8_t>(rx_buffer[3]),
                  static_cast<uint8_t>(rx_buffer[4]),
                  static_cast<uint8_t>(rx_buffer[5]));
    }

    reader_done = true;
    PW_LOG_INFO("[Reader] Complete - all 3 reads done");
    co_return pw::OkStatus();
  };

  // Get the system time provider for async delays
  auto& time = pw::async2::GetSystemTimeProvider();

  // Writer coroutine - writes in chunks with async delays that yield to dispatcher
  auto writer_coro = [&](pw::async2::CoroContext&) -> pw::async2::Coro<pw::Status> {
    // Initial delay to let reader start and suspend
    PW_LOG_INFO("[Writer] Starting - will write 8, 1, 5, 4 bytes with delays");
    co_await time.WaitFor(50ms);

    // Write 1: 8 bytes (bytes 0-7)
    PW_LOG_INFO("[Writer] Writing 8 bytes...");
    uart.Write(pw::ConstByteSpan(kTestData.data(), 8));
    events[event_count++] = Event::kWrite1;
    PW_LOG_INFO("[Writer] Write 1 done (8 bytes)");
    co_await time.WaitFor(30ms);

    // Write 2: 1 byte (byte 8)
    PW_LOG_INFO("[Writer] Writing 1 byte...");
    uart.Write(pw::ConstByteSpan(kTestData.data() + 8, 1));
    events[event_count++] = Event::kWrite2;
    PW_LOG_INFO("[Writer] Write 2 done (1 byte)");
    co_await time.WaitFor(30ms);

    // Write 3: 5 bytes (bytes 9-13)
    PW_LOG_INFO("[Writer] Writing 5 bytes...");
    uart.Write(pw::ConstByteSpan(kTestData.data() + 9, 5));
    events[event_count++] = Event::kWrite3;
    PW_LOG_INFO("[Writer] Write 3 done (5 bytes)");
    co_await time.WaitFor(30ms);

    // Write 4: 4 bytes (bytes 14-17)
    PW_LOG_INFO("[Writer] Writing 4 bytes...");
    uart.Write(pw::ConstByteSpan(kTestData.data() + 14, 4));
    events[event_count++] = Event::kWrite4;
    PW_LOG_INFO("[Writer] Write 4 done (4 bytes)");

    writer_done = true;
    PW_LOG_INFO("[Writer] Complete - all 4 writes done");
    co_return pw::OkStatus();
  };

  // Create coroutine contexts
  pw::async2::CoroContext reader_cx(test_allocator);
  pw::async2::CoroContext writer_cx(test_allocator);

  auto reader = reader_coro(reader_cx);
  auto writer = writer_coro(writer_cx);

  pw::async2::CoroOrElseTask reader_task(
      std::move(reader), [](pw::Status status) {
        if (!status.ok()) {
          PW_LOG_ERROR("[Reader] Failed: %d", static_cast<int>(status.code()));
        }
      });

  pw::async2::CoroOrElseTask writer_task(
      std::move(writer), [](pw::Status status) {
        if (!status.ok()) {
          PW_LOG_ERROR("[Writer] Failed: %d", static_cast<int>(status.code()));
        }
      });

  // Post both tasks - reader first so it starts waiting
  dispatcher_.Post(reader_task);
  dispatcher_.Post(writer_task);

  // Run dispatcher until both complete
  int iterations = 0;
  constexpr int kMaxIterations = 3000;  // ~3 seconds

  while ((reader_task.IsRegistered() || writer_task.IsRegistered()) &&
         iterations++ < kMaxIterations) {
    dispatcher_.RunUntilStalled();
    HAL_Delay_Milliseconds(1);
  }

  ASSERT_LT(iterations, kMaxIterations) << "Test timed out";
  ASSERT_TRUE(reader_done) << "Reader did not complete";
  ASSERT_TRUE(writer_done) << "Writer did not complete";
  ASSERT_EQ(event_count, 7u) << "Not all events recorded";

  // Log the actual event order - with async yields, reads interleave with writes
  // Expected interleaving: W1 -> R0 -> W2 -> W3 -> R1 -> W4 -> R2
  // (After W1 sends 8 bytes, R0 can complete with 6; remaining 2 + W2's 1 + W3's 5 = 8 for R1, etc.)
  PW_LOG_INFO("Event order:");
  for (size_t i = 0; i < event_count; ++i) {
    int val = static_cast<int>(events[i]);
    if (val < 4) {
      PW_LOG_INFO("  [%u] W%d", static_cast<unsigned>(i), val + 1);
    } else {
      PW_LOG_INFO("  [%u] R%d", static_cast<unsigned>(i), val - 4);
    }
  }

  // Verify interleaving happened - R0 should complete before all writes are done
  // (i.e., R0 should appear before W4 in the event list)
  bool found_r0 = false;
  bool found_w4_before_r0 = false;
  for (size_t i = 0; i < event_count; ++i) {
    if (events[i] == Event::kRead0) {
      found_r0 = true;
      break;
    }
    if (events[i] == Event::kWrite4) {
      found_w4_before_r0 = true;
    }
  }
  ASSERT_TRUE(found_r0) << "R0 not found in events";
  ASSERT_FALSE(found_w4_before_r0) << "No interleaving: W4 completed before R0";

  // Verify all data was received correctly
  bool data_match = std::memcmp(received_data.data(), kTestData.data(), 18) == 0;
  ASSERT_TRUE(data_match) << "Received data does not match sent data";

  PW_LOG_INFO("Interleaved reads/writes: PASSED");
}

// Test 5: Read timeout
//
// Request to read 5 bytes but don't send any data.
// The read should fail with DeadlineExceeded after the timeout.
TEST_F(AsyncUartLoopbackTest, ReadTimeout) {
  auto& uart = GetUart();

  PW_LOG_INFO("Testing: Read with timeout (expecting DeadlineExceeded)");

  bool got_timeout = false;
  constexpr uint32_t kTimeoutMs = 100;  // 100ms timeout

  auto test_coro = [&](pw::async2::CoroContext&) -> pw::async2::Coro<pw::Status> {
    std::array<std::byte, 8> rx_buffer{};

    PW_LOG_INFO("Starting read with %ums timeout, waiting for 5 bytes...",
                static_cast<unsigned>(kTimeoutMs));

    // Request 5 bytes with timeout - but don't send any data
    auto result = co_await uart.ReadWithTimeout(rx_buffer, 5, kTimeoutMs);

    if (result.status().IsDeadlineExceeded()) {
      got_timeout = true;
      PW_LOG_INFO("Read timed out as expected (DeadlineExceeded)");
      co_return pw::OkStatus();
    }

    // Unexpected result
    PW_LOG_ERROR("Expected DeadlineExceeded, got status=%d size=%u",
                 static_cast<int>(result.status().code()),
                 static_cast<unsigned>(result.size()));
    co_return pw::Status::Internal();
  };

  pw::async2::CoroContext coro_cx(test_allocator);
  auto coro = test_coro(coro_cx);

  pw::async2::CoroOrElseTask task(
      std::move(coro), [](pw::Status status) {
        if (!status.ok()) {
          PW_LOG_ERROR("Timeout test failed: %d", static_cast<int>(status.code()));
        }
      });

  dispatcher_.Post(task);

  // Run dispatcher - should complete within timeout + some margin
  int iterations = 0;
  constexpr int kMaxIterations = 500;  // 500ms max (timeout is 100ms)

  while (task.IsRegistered() && iterations++ < kMaxIterations) {
    dispatcher_.RunUntilStalled();
    HAL_Delay_Milliseconds(1);
  }

  ASSERT_LT(iterations, kMaxIterations) << "Test did not complete in time";
  ASSERT_TRUE(got_timeout) << "Did not get expected timeout";

  // Verify timeout happened around the expected time (100ms +/- 50ms margin)
  ASSERT_GT(iterations, 50) << "Timeout happened too fast";
  ASSERT_LT(iterations, 200) << "Timeout happened too slow";

  PW_LOG_INFO("Read timeout: PASSED (completed in ~%dms)", iterations);
}

}  // namespace
