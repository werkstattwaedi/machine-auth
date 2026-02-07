// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// On-device SPI loopback test for ParticleSpiInitiator.
//
// HARDWARE SETUP REQUIRED:
// Connect MOSI to MISO on SPI1 (HAL_SPI_INTERFACE2):
//   D3 (MOSI) -> D2 (MISO)
//
// This test verifies that data written to the SPI bus is correctly received
// back when MOSI is wired to MISO, demonstrating the full DMA transfer path.

#include "pb_spi/initiator.h"

#include <array>
#include <cstring>

#include "pw_log/log.h"
#include "pw_unit_test/framework.h"

namespace pb {
namespace {

// Test fixture for SPI loopback tests
class SpiLoopbackTest : public ::testing::Test {
 protected:
  void SetUp() override {
    // Create initiator for SPI1 at 1 MHz (slower for reliable loopback)
    spi_ = std::make_unique<ParticleSpiInitiator>(
        ParticleSpiInitiator::Interface::kSpi1, 1'000'000);
  }

  void TearDown() override { spi_.reset(); }

  std::unique_ptr<ParticleSpiInitiator> spi_;
};

TEST_F(SpiLoopbackTest, ConfigureSucceeds) {
  const pw::spi::Config config = {
      .polarity = pw::spi::ClockPolarity::kActiveHigh,
      .phase = pw::spi::ClockPhase::kRisingEdge,
      .bits_per_word = pw::spi::BitsPerWord(8),
      .bit_order = pw::spi::BitOrder::kMsbFirst,
  };

  const pw::Status status = spi_->Configure(config);
  EXPECT_EQ(status, pw::OkStatus());
}

TEST_F(SpiLoopbackTest, WriteReadLoopbackSingleByte) {
  // Configure SPI Mode 0, MSB first
  const pw::spi::Config config = {
      .polarity = pw::spi::ClockPolarity::kActiveHigh,
      .phase = pw::spi::ClockPhase::kRisingEdge,
      .bits_per_word = pw::spi::BitsPerWord(8),
      .bit_order = pw::spi::BitOrder::kMsbFirst,
  };
  ASSERT_EQ(spi_->Configure(config), pw::OkStatus());

  // Write a single byte and read it back via loopback
  std::array<std::byte, 1> tx_data = {std::byte{0xA5}};
  std::array<std::byte, 1> rx_data = {std::byte{0x00}};

  const pw::Status status =
      spi_->WriteRead(pw::as_bytes(pw::span(tx_data)), pw::as_writable_bytes(pw::span(rx_data)));

  EXPECT_EQ(status, pw::OkStatus());
  // With MOSI->MISO loopback, we should receive what we sent
  EXPECT_EQ(rx_data[0], tx_data[0]);
}

TEST_F(SpiLoopbackTest, WriteReadLoopbackMultipleBytes) {
  const pw::spi::Config config = {
      .polarity = pw::spi::ClockPolarity::kActiveHigh,
      .phase = pw::spi::ClockPhase::kRisingEdge,
      .bits_per_word = pw::spi::BitsPerWord(8),
      .bit_order = pw::spi::BitOrder::kMsbFirst,
  };
  ASSERT_EQ(spi_->Configure(config), pw::OkStatus());

  // Write multiple bytes and read them back
  std::array<std::byte, 16> tx_data;
  for (size_t i = 0; i < tx_data.size(); ++i) {
    tx_data[i] = static_cast<std::byte>(i * 17);  // 0x00, 0x11, 0x22, ...
  }
  std::array<std::byte, 16> rx_data = {};

  const pw::Status status =
      spi_->WriteRead(pw::as_bytes(pw::span(tx_data)), pw::as_writable_bytes(pw::span(rx_data)));

  EXPECT_EQ(status, pw::OkStatus());
  EXPECT_EQ(std::memcmp(tx_data.data(), rx_data.data(), tx_data.size()), 0);
}

TEST_F(SpiLoopbackTest, WriteReadLoopbackLargeBuffer) {
  const pw::spi::Config config = {
      .polarity = pw::spi::ClockPolarity::kActiveHigh,
      .phase = pw::spi::ClockPhase::kRisingEdge,
      .bits_per_word = pw::spi::BitsPerWord(8),
      .bit_order = pw::spi::BitOrder::kMsbFirst,
  };
  ASSERT_EQ(spi_->Configure(config), pw::OkStatus());

  // Test with a larger buffer (similar to display flush sizes)
  constexpr size_t kBufferSize = 1024;
  std::array<std::byte, kBufferSize> tx_data;
  for (size_t i = 0; i < tx_data.size(); ++i) {
    tx_data[i] = static_cast<std::byte>(i & 0xFF);
  }
  std::array<std::byte, kBufferSize> rx_data = {};

  const pw::Status status =
      spi_->WriteRead(pw::as_bytes(pw::span(tx_data)), pw::as_writable_bytes(pw::span(rx_data)));

  EXPECT_EQ(status, pw::OkStatus());
  EXPECT_EQ(std::memcmp(tx_data.data(), rx_data.data(), tx_data.size()), 0);
}

TEST_F(SpiLoopbackTest, WriteOnlyDoesNotTimeout) {
  const pw::spi::Config config = {
      .polarity = pw::spi::ClockPolarity::kActiveHigh,
      .phase = pw::spi::ClockPhase::kRisingEdge,
      .bits_per_word = pw::spi::BitsPerWord(8),
      .bit_order = pw::spi::BitOrder::kMsbFirst,
  };
  ASSERT_EQ(spi_->Configure(config), pw::OkStatus());

  // Write-only transfer (no rx buffer, like display flush)
  std::array<std::byte, 256> tx_data;
  std::fill(tx_data.begin(), tx_data.end(), std::byte{0xCC});

  const pw::Status status = spi_->WriteRead(
      pw::as_bytes(pw::span(tx_data)), pw::ByteSpan());

  EXPECT_EQ(status, pw::OkStatus());
}

TEST_F(SpiLoopbackTest, AllSpiModes) {
  // Test all four SPI modes work correctly
  const std::array<pw::spi::Config, 4> configs = {{
      // Mode 0: CPOL=0, CPHA=0
      {pw::spi::ClockPolarity::kActiveHigh, pw::spi::ClockPhase::kRisingEdge,
       pw::spi::BitsPerWord(8), pw::spi::BitOrder::kMsbFirst},
      // Mode 1: CPOL=0, CPHA=1
      {pw::spi::ClockPolarity::kActiveHigh, pw::spi::ClockPhase::kFallingEdge,
       pw::spi::BitsPerWord(8), pw::spi::BitOrder::kMsbFirst},
      // Mode 2: CPOL=1, CPHA=0
      {pw::spi::ClockPolarity::kActiveLow, pw::spi::ClockPhase::kRisingEdge,
       pw::spi::BitsPerWord(8), pw::spi::BitOrder::kMsbFirst},
      // Mode 3: CPOL=1, CPHA=1
      {pw::spi::ClockPolarity::kActiveLow, pw::spi::ClockPhase::kFallingEdge,
       pw::spi::BitsPerWord(8), pw::spi::BitOrder::kMsbFirst},
  }};

  for (size_t mode = 0; mode < configs.size(); ++mode) {
    SCOPED_TRACE(testing::Message() << "SPI Mode " << mode);

    ASSERT_EQ(spi_->Configure(configs[mode]), pw::OkStatus());

    std::array<std::byte, 4> tx_data = {std::byte{0xDE}, std::byte{0xAD},
                                        std::byte{0xBE}, std::byte{0xEF}};
    std::array<std::byte, 4> rx_data = {};

    const pw::Status status = spi_->WriteRead(
        pw::as_bytes(pw::span(tx_data)), pw::as_writable_bytes(pw::span(rx_data)));

    EXPECT_EQ(status, pw::OkStatus());
    EXPECT_EQ(std::memcmp(tx_data.data(), rx_data.data(), tx_data.size()), 0);
  }
}

}  // namespace
}  // namespace pb
