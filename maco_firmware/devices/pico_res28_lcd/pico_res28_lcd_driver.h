// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>

#include "maco_firmware/modules/display/display_driver.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_digital_io/digital_io.h"
#include "pw_thread/thread.h"

// DeviceOS concurrent primitives - these work correctly with LVGL
// when calling lv_display_flush_ready() from a different thread.
#include "concurrent_hal.h"

namespace maco::display {

/// Request passed from LVGL callback to flush thread.
struct FlushRequest {
  lv_area_t area;
  const uint8_t* px_map;
  size_t byte_count;
};

/// SPI LCD driver for Pico-ResTouch-LCD-2.8 display (Waveshare).
/// Uses ST7789 controller connected via SPI.
///
/// This driver uses direct HAL SPI access for DMA transfers with timeout/cancel
/// logic to work around DeviceOS SPI DMA deadlock bugs.
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
  /// @param hal_spi_interface HAL SPI interface (e.g., HAL_SPI_INTERFACE2)
  /// @param spi_clock_hz SPI clock frequency in Hz
  /// @param cs Chip select GPIO (directly controlled)
  /// @param dc Data/Command GPIO (LOW = command, HIGH = data)
  /// @param rst Reset GPIO
  /// @param bl Backlight GPIO
  /// @param thread_options Thread options for the flush thread
  /// @param dma_timeout DMA transfer timeout duration
  PicoRes28LcdDriver(
      int hal_spi_interface,
      uint32_t spi_clock_hz,
      pw::digital_io::DigitalOut& cs,
      pw::digital_io::DigitalOut& dc,
      pw::digital_io::DigitalOut& rst,
      pw::digital_io::DigitalOut& bl,
      const pw::thread::Options& thread_options,
      pw::chrono::SystemClock::duration dma_timeout
  );

  ~PicoRes28LcdDriver() override = default;

  // Non-copyable, non-movable (holds references)
  PicoRes28LcdDriver(const PicoRes28LcdDriver&) = delete;
  PicoRes28LcdDriver& operator=(const PicoRes28LcdDriver&) = delete;

  pw::Status Init() override;
  pw::Result<lv_display_t*> CreateLvglDisplay() override;

  uint16_t width() const override { return kWidth; }
  uint16_t height() const override { return kHeight; }

  /// Returns the count of DMA transfers that timed out and were cancelled.
  /// Useful for diagnostics - some hangs are expected, but display should
  /// recover.
  uint32_t dma_hang_count() const { return dma_hang_count_; }

 private:
  // LVGL flush callback (static, looks up instance from user_data)
  static void FlushCallback(
      lv_display_t* disp, const lv_area_t* area, uint8_t* px_map
  );

  // DMA completion callback (static, routes to g_dma_instance)
  static void DmaCallback();

  void HardwareReset();

  // Flush thread entry point
  void FlushThreadMain();

  // Process a single flush request
  void ProcessFlushRequest(const FlushRequest& request);

  // Send command + optional data via HAL SPI (blocking, for small transfers)
  void SendCommand(pw::ConstByteSpan cmd, pw::ConstByteSpan data);

  // Send pixel data via HAL DMA with timeout/cancel
  void SendPixelDataDma(pw::ConstByteSpan pixels);

  // Hardware config
  int hal_spi_interface_;
  uint32_t spi_clock_hz_;
  pw::digital_io::DigitalOut& cs_;
  pw::digital_io::DigitalOut& dc_;
  pw::digital_io::DigitalOut& rst_;
  pw::digital_io::DigitalOut& bl_;

  // Thread config
  const pw::thread::Options& thread_options_;
  pw::chrono::SystemClock::duration dma_timeout_;

  // State
  lv_display_t* display_ = nullptr;

  // Flush request queue (DeviceOS queue primitive)
  // Single-element queue - LVGL waits for flush_ready before next flush
  os_queue_t flush_queue_ = nullptr;

  // DMA completion synchronization (DeviceOS semaphore)
  os_semaphore_t dma_complete_ = nullptr;

  // Flush completion synchronization - flush thread signals, main thread waits
  os_semaphore_t flush_done_ = nullptr;

  // Flush thread (runs forever, no shutdown needed)
  std::optional<pw::Thread> flush_thread_;

  // Diagnostics
  uint32_t dma_hang_count_ = 0;

  // Draw buffers (1/10 of screen, double buffered, partial rendering), RGB565
  // Aligned for DMA transfers
  static constexpr size_t kBufferSize = kWidth * (kHeight / 10) * 2;
  alignas(4) uint8_t draw_buf1_[kBufferSize];
  alignas(4) uint8_t draw_buf2_[kBufferSize];
};

}  // namespace maco::display
