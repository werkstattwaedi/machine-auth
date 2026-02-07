// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Hardware loopback test for ParticleUartStream.
//
// WIRING REQUIRED:
//   Serial1 TX (D8/TX) --> Serial2 RX (D5)
//   Serial2 TX (D4) --> Serial1 RX (D9/RX)
//
// This creates a crossover loopback between two UARTs to verify
// both TX and RX functionality independently.

#include "pb_stream/uart_stream.h"

#include "delay_hal.h"
#include "pw_bytes/array.h"
#include "pw_log/log.h"
#include "pw_unit_test/framework.h"

namespace {

constexpr uint32_t kBaudRate = 115200;

// Test pattern - recognizable bytes
constexpr auto kTestPattern = pw::bytes::Array<
    0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03, 0x04,
    0xCA, 0xFE, 0xBA, 0xBE, 0x05, 0x06, 0x07, 0x08>();

class UartLoopbackTest : public ::testing::Test {
 protected:
  void SetUp() override {
    PW_LOG_INFO("=== UartLoopbackTest::SetUp ===");
    PW_LOG_INFO("Wiring: D8(TX)->D5, D4->D9(RX)");
  }

  void TearDown() override {
    PW_LOG_INFO("=== UartLoopbackTest::TearDown ===");
    serial1_.Deinit();
    serial2_.Deinit();
  }

  // Helper to drain any garbage from RX buffer
  void DrainRx(pb::ParticleUartStream& serial) {
    std::array<std::byte, 64> discard{};
    while (true) {
      auto result = serial.Read(discard);
      if (!result.ok() || result.value().empty()) break;
      PW_LOG_INFO("Drained %u bytes",
                  static_cast<unsigned>(result.value().size()));
    }
  }

  pb::ParticleUartStream serial1_{HAL_USART_SERIAL1};
  pb::ParticleUartStream serial2_{HAL_USART_SERIAL2};
};

TEST_F(UartLoopbackTest, Init_BothPorts) {
  PW_LOG_INFO("Initializing Serial1 and Serial2...");

  auto status1 = serial1_.Init(kBaudRate);
  ASSERT_TRUE(status1.ok()) << "Serial1 init failed";

  auto status2 = serial2_.Init(kBaudRate);
  ASSERT_TRUE(status2.ok()) << "Serial2 init failed";

  PW_LOG_INFO("Both ports initialized at %lu baud",
              static_cast<unsigned long>(kBaudRate));
}

TEST_F(UartLoopbackTest, Serial1Tx_Serial2Rx) {
  ASSERT_TRUE(serial1_.Init(kBaudRate).ok());
  ASSERT_TRUE(serial2_.Init(kBaudRate).ok());

  // Drain any garbage from previous tests
  DrainRx(serial1_);
  DrainRx(serial2_);

  PW_LOG_INFO("Testing: Serial1 TX (D8) -> Serial2 RX (D5)");

  // Write test pattern on Serial1
  auto write_status = serial1_.Write(kTestPattern);
  ASSERT_TRUE(write_status.ok()) << "Serial1 write failed";
  PW_LOG_INFO("Sent %u bytes on Serial1",
              static_cast<unsigned>(kTestPattern.size()));

  // Wait for data to arrive
  HAL_Delay_Milliseconds(10);

  // Read on Serial2
  std::array<std::byte, 32> rx_buffer{};
  size_t total_read = 0;

  for (int attempt = 0; attempt < 10 && total_read < kTestPattern.size(); ++attempt) {
    auto result = serial2_.Read(
        pw::ByteSpan(rx_buffer.data() + total_read,
                     rx_buffer.size() - total_read));
    if (result.ok() && !result.value().empty()) {
      PW_LOG_INFO("Read %u bytes on attempt %d",
                  static_cast<unsigned>(result.value().size()), attempt);
      total_read += result.value().size();
    } else {
      HAL_Delay_Milliseconds(5);
    }
  }

  PW_LOG_INFO("Total received: %u bytes", static_cast<unsigned>(total_read));
  ASSERT_EQ(total_read, kTestPattern.size()) << "Did not receive all bytes";

  // Verify data
  for (size_t i = 0; i < kTestPattern.size(); ++i) {
    EXPECT_EQ(rx_buffer[i], kTestPattern[i])
        << "Mismatch at byte " << i;
  }

  PW_LOG_INFO("Serial1 TX -> Serial2 RX: PASSED");
}

TEST_F(UartLoopbackTest, Serial2Tx_Serial1Rx) {
  ASSERT_TRUE(serial1_.Init(kBaudRate).ok());
  ASSERT_TRUE(serial2_.Init(kBaudRate).ok());

  // Drain any garbage from previous tests
  DrainRx(serial1_);
  DrainRx(serial2_);

  PW_LOG_INFO("Testing: Serial2 TX (D4) -> Serial1 RX (D9)");

  // Write test pattern on Serial2
  auto write_status = serial2_.Write(kTestPattern);
  ASSERT_TRUE(write_status.ok()) << "Serial2 write failed";
  PW_LOG_INFO("Sent %u bytes on Serial2",
              static_cast<unsigned>(kTestPattern.size()));

  // Wait for data to arrive
  HAL_Delay_Milliseconds(10);

  // Read on Serial1
  std::array<std::byte, 32> rx_buffer{};
  size_t total_read = 0;

  for (int attempt = 0; attempt < 10 && total_read < kTestPattern.size(); ++attempt) {
    auto result = serial1_.Read(
        pw::ByteSpan(rx_buffer.data() + total_read,
                     rx_buffer.size() - total_read));
    if (result.ok() && !result.value().empty()) {
      PW_LOG_INFO("Read %u bytes on attempt %d",
                  static_cast<unsigned>(result.value().size()), attempt);
      total_read += result.value().size();
    } else {
      HAL_Delay_Milliseconds(5);
    }
  }

  PW_LOG_INFO("Total received: %u bytes", static_cast<unsigned>(total_read));
  ASSERT_EQ(total_read, kTestPattern.size()) << "Did not receive all bytes";

  // Verify data
  for (size_t i = 0; i < kTestPattern.size(); ++i) {
    EXPECT_EQ(rx_buffer[i], kTestPattern[i])
        << "Mismatch at byte " << i;
  }

  PW_LOG_INFO("Serial2 TX -> Serial1 RX: PASSED");
}

TEST_F(UartLoopbackTest, Bidirectional_Simultaneous) {
  ASSERT_TRUE(serial1_.Init(kBaudRate).ok());
  ASSERT_TRUE(serial2_.Init(kBaudRate).ok());

  // Drain any garbage from previous tests
  DrainRx(serial1_);
  DrainRx(serial2_);

  PW_LOG_INFO("Testing: Bidirectional simultaneous transfer");

  // Different patterns for each direction
  constexpr auto kPattern1to2 = pw::bytes::Array<0xAA, 0xBB, 0xCC, 0xDD>();
  constexpr auto kPattern2to1 = pw::bytes::Array<0x11, 0x22, 0x33, 0x44>();

  // Send both directions
  ASSERT_TRUE(serial1_.Write(kPattern1to2).ok());
  ASSERT_TRUE(serial2_.Write(kPattern2to1).ok());
  PW_LOG_INFO("Sent patterns in both directions");

  HAL_Delay_Milliseconds(10);

  // Read both directions
  std::array<std::byte, 8> rx_on_serial2{};
  std::array<std::byte, 8> rx_on_serial1{};

  size_t read2 = 0, read1 = 0;
  for (int attempt = 0; attempt < 10; ++attempt) {
    if (read2 < kPattern1to2.size()) {
      auto r = serial2_.Read(pw::ByteSpan(rx_on_serial2.data() + read2,
                                          rx_on_serial2.size() - read2));
      if (r.ok()) read2 += r.value().size();
    }
    if (read1 < kPattern2to1.size()) {
      auto r = serial1_.Read(pw::ByteSpan(rx_on_serial1.data() + read1,
                                          rx_on_serial1.size() - read1));
      if (r.ok()) read1 += r.value().size();
    }
    if (read2 >= kPattern1to2.size() && read1 >= kPattern2to1.size()) {
      break;
    }
    HAL_Delay_Milliseconds(5);
  }

  PW_LOG_INFO("Received: %u on Serial2, %u on Serial1",
              static_cast<unsigned>(read2), static_cast<unsigned>(read1));

  ASSERT_EQ(read2, kPattern1to2.size());
  ASSERT_EQ(read1, kPattern2to1.size());

  // Verify both patterns
  for (size_t i = 0; i < kPattern1to2.size(); ++i) {
    EXPECT_EQ(rx_on_serial2[i], kPattern1to2[i]);
  }
  for (size_t i = 0; i < kPattern2to1.size(); ++i) {
    EXPECT_EQ(rx_on_serial1[i], kPattern2to1[i]);
  }

  PW_LOG_INFO("Bidirectional: PASSED");
}

}  // namespace
