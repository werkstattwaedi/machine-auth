// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Unit tests for PicoRes28LcdDriver verifying correct SPI byte sequences.

#include "maco_firmware/devices/pico_res28_lcd/pico_res28_lcd_driver.h"

#include "lvgl.h"
#include "pw_bytes/array.h"
#include "pw_digital_io/digital_io_mock.h"
#include "pw_spi/initiator_mock.h"
#include "pw_unit_test/framework.h"

namespace maco::display {
namespace {

// Test subclass that exposes protected methods
class TestablePicoRes28LcdDriver : public PicoRes28LcdDriver {
 public:
  using PicoRes28LcdDriver::Flush;
  using PicoRes28LcdDriver::PicoRes28LcdDriver;
  using PicoRes28LcdDriver::SendData;
};

using State = pw::digital_io::State;

// MIPI DCS commands
constexpr auto kCasetCmd = pw::bytes::Array<0x2A>();
constexpr auto kRasetCmd = pw::bytes::Array<0x2B>();
constexpr auto kRamwrCmd = pw::bytes::Array<0x2C>();

// Expected CASET data for area x1=0, x2=239
// 239 = 0x00EF in big-endian: [0x00, 0x00, 0x00, 0xEF]
constexpr auto kCasetData_0_239 = pw::bytes::Array<0x00, 0x00, 0x00, 0xEF>();

// Expected RASET data for area y1=0, y2=31
// 31 = 0x001F in big-endian: [0x00, 0x00, 0x00, 0x1F]
constexpr auto kRasetData_0_31 = pw::bytes::Array<0x00, 0x00, 0x00, 0x1F>();

// Flush() calls SendData 3 times (CASET, RASET, RAMWR), each SendData does:
// 1. SPI write for command (if non-empty)
// 2. SPI write for data (if non-empty)
// So we expect 6 SPI transactions total.

TEST(PicoRes28LcdDriverTest, FlushSendsCorrectByteSequence) {
  // Sample pixel data (4 bytes = 2 RGB565 pixels)
  constexpr auto kPixelData = pw::bytes::Array<0xF8, 0x00, 0x07, 0xE0>();

  // Define expected SPI transactions in order
  auto transactions = pw::spi::MakeExpectedTransactionArray({
      // CASET command
      pw::spi::MockWriteTransaction(pw::OkStatus(), kCasetCmd),
      // CASET data: x1=0 (0x0000), x2=239 (0x00EF)
      pw::spi::MockWriteTransaction(pw::OkStatus(), kCasetData_0_239),
      // RASET command
      pw::spi::MockWriteTransaction(pw::OkStatus(), kRasetCmd),
      // RASET data: y1=0 (0x0000), y2=31 (0x001F)
      pw::spi::MockWriteTransaction(pw::OkStatus(), kRasetData_0_31),
      // RAMWR command
      pw::spi::MockWriteTransaction(pw::OkStatus(), kRamwrCmd),
      // Pixel data
      pw::spi::MockWriteTransaction(pw::OkStatus(), kPixelData),
  });
  pw::spi::MockInitiator spi_mock(transactions);

  // GPIO mocks using sibling cast to DigitalOut
  pw::digital_io::DigitalInOutMock<20> cs_mock;
  pw::digital_io::DigitalInOutMock<20> dc_mock;
  pw::digital_io::DigitalInOutMock<20> rst_mock;
  pw::digital_io::DigitalInOutMock<20> bl_mock;

  TestablePicoRes28LcdDriver driver(
      spi_mock,
      cs_mock.as<pw::digital_io::DigitalOut>(),
      dc_mock.as<pw::digital_io::DigitalOut>(),
      rst_mock.as<pw::digital_io::DigitalOut>(),
      bl_mock.as<pw::digital_io::DigitalOut>()
  );

  // Define the area to flush
  lv_area_t area = {.x1 = 0, .y1 = 0, .x2 = 239, .y2 = 31};

  // Call Flush
  driver.Flush(&area, kPixelData);

  // Verify all expected SPI transactions were executed
  EXPECT_EQ(spi_mock.Finalize(), pw::OkStatus());
}

TEST(PicoRes28LcdDriverTest, FlushWithNonZeroCoordinates) {
  // Test with non-zero starting coordinates
  // x1=10 (0x000A), x2=100 (0x0064), y1=20 (0x0014), y2=50 (0x0032)
  constexpr auto kCasetData = pw::bytes::Array<0x00, 0x0A, 0x00, 0x64>();
  constexpr auto kRasetData = pw::bytes::Array<0x00, 0x14, 0x00, 0x32>();
  constexpr auto kPixelData = pw::bytes::Array<0xAB, 0xCD>();

  auto transactions = pw::spi::MakeExpectedTransactionArray({
      pw::spi::MockWriteTransaction(pw::OkStatus(), kCasetCmd),
      pw::spi::MockWriteTransaction(pw::OkStatus(), kCasetData),
      pw::spi::MockWriteTransaction(pw::OkStatus(), kRasetCmd),
      pw::spi::MockWriteTransaction(pw::OkStatus(), kRasetData),
      pw::spi::MockWriteTransaction(pw::OkStatus(), kRamwrCmd),
      pw::spi::MockWriteTransaction(pw::OkStatus(), kPixelData),
  });
  pw::spi::MockInitiator spi_mock(transactions);

  pw::digital_io::DigitalInOutMock<20> cs_mock;
  pw::digital_io::DigitalInOutMock<20> dc_mock;
  pw::digital_io::DigitalInOutMock<20> rst_mock;
  pw::digital_io::DigitalInOutMock<20> bl_mock;

  TestablePicoRes28LcdDriver driver(
      spi_mock,
      cs_mock.as<pw::digital_io::DigitalOut>(),
      dc_mock.as<pw::digital_io::DigitalOut>(),
      rst_mock.as<pw::digital_io::DigitalOut>(),
      bl_mock.as<pw::digital_io::DigitalOut>()
  );

  lv_area_t area = {.x1 = 10, .y1 = 20, .x2 = 100, .y2 = 50};
  driver.Flush(&area, kPixelData);

  EXPECT_EQ(spi_mock.Finalize(), pw::OkStatus());
}

// =============================================================================
// SendData tests
// =============================================================================

TEST(PicoRes28LcdDriverTest, SendDataWithCmdAndData) {
  constexpr auto kCmd = pw::bytes::Array<0x2A>();
  constexpr auto kData = pw::bytes::Array<0x00, 0x10, 0x00, 0x20>();

  // Expected SPI: cmd write, then data write
  auto transactions = pw::spi::MakeExpectedTransactionArray({
      pw::spi::MockWriteTransaction(pw::OkStatus(), kCmd),
      pw::spi::MockWriteTransaction(pw::OkStatus(), kData),
  });
  pw::spi::MockInitiator spi_mock(transactions);

  pw::digital_io::DigitalInOutMock<10> cs_mock;
  pw::digital_io::DigitalInOutMock<10> dc_mock;
  pw::digital_io::DigitalInOutMock<10> rst_mock;
  pw::digital_io::DigitalInOutMock<10> bl_mock;

  TestablePicoRes28LcdDriver driver(
      spi_mock,
      cs_mock.as<pw::digital_io::DigitalOut>(),
      dc_mock.as<pw::digital_io::DigitalOut>(),
      rst_mock.as<pw::digital_io::DigitalOut>(),
      bl_mock.as<pw::digital_io::DigitalOut>()
  );

  driver.SendData(kCmd, kData);

  // Verify SPI transactions
  EXPECT_EQ(spi_mock.Finalize(), pw::OkStatus());

  // Verify CS sequence: starts inactive (from mock init), goes low, ends high
  // DigitalInOutMock starts in kInactive state
  auto& cs_events = cs_mock.events();
  ASSERT_GE(cs_events.size(), 2u);
  // First event: CS low (select)
  EXPECT_EQ(cs_events[0].state, State::kInactive);
  // Last event: CS high (deselect)
  EXPECT_EQ(cs_events[cs_events.size() - 1].state, State::kActive);

  // Verify DC sequence: low for cmd, high for data
  // Note: DigitalInOutMock constructor creates initial event at kInactive
  auto& dc_events = dc_mock.events();
  ASSERT_GE(dc_events.size(), 3u);
  // Event 0: from mock constructor (kInactive)
  // Event 1: DC low for command
  EXPECT_EQ(dc_events[1].state, State::kInactive);
  // Event 2: DC high for data
  EXPECT_EQ(dc_events[2].state, State::kActive);
}

TEST(PicoRes28LcdDriverTest, SendDataWithEmptyData) {
  constexpr auto kCmd = pw::bytes::Array<0x2C>();

  // Only command write, no data
  auto transactions = pw::spi::MakeExpectedTransactionArray({
      pw::spi::MockWriteTransaction(pw::OkStatus(), kCmd),
  });
  pw::spi::MockInitiator spi_mock(transactions);

  pw::digital_io::DigitalInOutMock<10> cs_mock;
  pw::digital_io::DigitalInOutMock<10> dc_mock;
  pw::digital_io::DigitalInOutMock<10> rst_mock;
  pw::digital_io::DigitalInOutMock<10> bl_mock;

  TestablePicoRes28LcdDriver driver(
      spi_mock,
      cs_mock.as<pw::digital_io::DigitalOut>(),
      dc_mock.as<pw::digital_io::DigitalOut>(),
      rst_mock.as<pw::digital_io::DigitalOut>(),
      bl_mock.as<pw::digital_io::DigitalOut>()
  );

  // Call with empty data span
  driver.SendData(kCmd, pw::ConstByteSpan());

  // Verify only 1 SPI transaction (command only)
  EXPECT_EQ(spi_mock.Finalize(), pw::OkStatus());

  // Verify CS sequence
  auto& cs_events = cs_mock.events();
  ASSERT_GE(cs_events.size(), 2u);
  EXPECT_EQ(cs_events[0].state, State::kInactive);                   // CS low
  EXPECT_EQ(cs_events[cs_events.size() - 1].state, State::kActive);  // CS high

  // Verify DC: only goes low for command, never goes high (no data)
  // Note: DigitalInOutMock constructor creates initial event at kInactive
  auto& dc_events = dc_mock.events();
  ASSERT_GE(dc_events.size(), 2u);
  // Event 0: from mock constructor (kInactive)
  // Event 1: DC low for command
  EXPECT_EQ(dc_events[1].state, State::kInactive);
  // Should only have 2 events (no DC high for data)
  EXPECT_EQ(dc_events.size(), 2u) << "DC should not go high when data is empty";
}

}  // namespace
}  // namespace maco::display
