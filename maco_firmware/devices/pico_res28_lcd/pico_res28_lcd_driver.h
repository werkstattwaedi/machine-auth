// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/display/display_driver.h"
#include "pw_digital_io/digital_io.h"
#include "pw_spi/initiator.h"

namespace maco::display {

/// SPI LCD driver for Pico-ResTouch-LCD-2.8 display (Waveshare).
/// Uses ST7789 controller connected via SPI.
///
/// Hardware dependencies are injected via constructor, following Pigweed
/// patterns. Pin assignments and SPI initialization happen in the platform's
/// system.cc, not here.
///
/// Uses LVGL's lv_lcd_generic_mipi driver for the init sequence.
class PicoRes28LcdDriver : public DisplayDriver {
 public:
  /// Display dimensions
  static constexpr uint16_t kWidth = 240;
  static constexpr uint16_t kHeight = 320;

  /// Constructor with hardware dependency injection.
  /// @param spi SPI initiator (already configured with clock speed)
  /// @param cs Chip select GPIO (directly controlled, not via pw::spi::Device)
  /// @param dc Data/Command GPIO (LOW = command, HIGH = data)
  /// @param rst Reset GPIO
  /// @param bl Backlight GPIO
  PicoRes28LcdDriver(
      pw::spi::Initiator& spi,
      pw::digital_io::DigitalOut& cs,
      pw::digital_io::DigitalOut& dc,
      pw::digital_io::DigitalOut& rst,
      pw::digital_io::DigitalOut& bl
  );

  ~PicoRes28LcdDriver() override = default;

  // Non-copyable, non-movable (holds references)
  PicoRes28LcdDriver(const PicoRes28LcdDriver&) = delete;
  PicoRes28LcdDriver& operator=(const PicoRes28LcdDriver&) = delete;

  pw::Status Init() override;
  pw::Result<lv_display_t*> CreateLvglDisplay() override;

  uint16_t width() const override { return kWidth; }
  uint16_t height() const override { return kHeight; }

 private:
  // LVGL flush callback (static, looks up instance from user_data)
  static void FlushCallback(
      lv_display_t* disp, const lv_area_t* area, uint8_t* px_map
  );

  // Core SPI transfer: sends command with DC=low, then data with DC=high
  void SendData(pw::ConstByteSpan cmd, pw::ConstByteSpan data);

  // Instance methods
  void Flush(const lv_area_t* area, pw::ConstByteSpan pixels);
  void HardwareReset();

  // Hardware dependencies (injected)
  pw::spi::Initiator& spi_;
  pw::digital_io::DigitalOut& cs_;
  pw::digital_io::DigitalOut& dc_;
  pw::digital_io::DigitalOut& rst_;
  pw::digital_io::DigitalOut& bl_;

  // State
  lv_display_t* display_ = nullptr;

  // Draw buffers (1/10 of screen, double buffered, partial rendering), RGB565
  // Aligned for DMA transfers
  static constexpr size_t kBufferSize = kWidth * (kHeight / 10) * 2;
  alignas(4) uint8_t draw_buf1_[kBufferSize];
  alignas(4) uint8_t draw_buf2_[kBufferSize];
};

}  // namespace maco::display
