// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pico_res28_lcd/pico_res28_lcd_driver.h"

#include <drivers/display/lcd/lv_lcd_generic_mipi.h>

#include "maco_firmware/modules/display/display_metrics.h"
#include "pw_assert/check.h"
#include "pw_bytes/array.h"
#include "pw_bytes/span.h"
#include "pw_log/log.h"
#include "pw_thread/sleep.h"
#include "spi_hal.h"

namespace maco::display {

namespace {

// Global instance pointer for DMA callback routing.
// Only one PicoRes28LcdDriver instance can use async DMA at a time.
// This is needed because hal_spi_transfer_dma doesn't support user data.
PicoRes28LcdDriver* g_dma_instance = nullptr;

// MIPI DCS commands
constexpr auto kCmdColumnAddressSet = pw::bytes::Array<0x2A>();  // CASET
constexpr auto kCmdRowAddressSet = pw::bytes::Array<0x2B>();     // RASET
constexpr auto kCmdMemoryWrite = pw::bytes::Array<0x2C>();       // RAMWR

// Helper to convert uint8_t pointer (from LVGL) to std::byte span
inline pw::ConstByteSpan AsBytes(const uint8_t* data, size_t size) {
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  return pw::ConstByteSpan(reinterpret_cast<const std::byte*>(data), size);
}

}  // namespace

// DMA timeout in OS ticks (milliseconds for FreeRTOS)
constexpr system_tick_t kDmaTimeoutMs = 20;

PicoRes28LcdDriver::PicoRes28LcdDriver(
    int hal_spi_interface,
    uint32_t spi_clock_hz,
    pw::digital_io::DigitalOut& cs,
    pw::digital_io::DigitalOut& dc,
    pw::digital_io::DigitalOut& rst,
    pw::digital_io::DigitalOut& bl,
    const pw::thread::Options& thread_options,
    pw::chrono::SystemClock::duration dma_timeout
)
    : hal_spi_interface_(hal_spi_interface),
      spi_clock_hz_(spi_clock_hz),
      cs_(cs),
      dc_(dc),
      rst_(rst),
      bl_(bl),
      thread_options_(thread_options),
      dma_timeout_(dma_timeout) {
  // Register as the global DMA instance
  PW_CHECK(
      g_dma_instance == nullptr,
      "Only one PicoRes28LcdDriver can use async DMA at a time"
  );
  g_dma_instance = this;

  // Create DeviceOS queue for flush requests (single element)
  int result = os_queue_create(&flush_queue_, sizeof(FlushRequest), 1, nullptr);
  PW_CHECK(result == 0, "Failed to create flush queue");

  // Create DeviceOS semaphore for DMA completion (binary: max=1, initial=0)
  result = os_semaphore_create(&dma_complete_, 1, 0);
  PW_CHECK(result == 0, "Failed to create DMA semaphore");

  // Create DeviceOS semaphore for flush completion (binary: max=1, initial=0)
  result = os_semaphore_create(&flush_done_, 1, 0);
  PW_CHECK(result == 0, "Failed to create flush_done semaphore");
}

pw::Status PicoRes28LcdDriver::Init() {
  PW_LOG_INFO("Initializing ST7789 display (%dx%d)", kWidth, kHeight);

  const auto hal_if = static_cast<hal_spi_interface_t>(hal_spi_interface_);

  // Enable GPIO pins
  PW_TRY(cs_.Enable());
  PW_TRY(dc_.Enable());
  PW_TRY(rst_.Enable());
  PW_TRY(bl_.Enable());

  // Initialize and configure HAL SPI
  hal_spi_init(hal_if);
  hal_spi_begin_ext(hal_if, SPI_MODE_MASTER, SPI_DEFAULT_SS, nullptr);

  // Calculate clock divider and configure SPI: Mode 0, MSB first
  const int divider = hal_spi_get_clock_divider(hal_if, spi_clock_hz_, nullptr);
  PW_CHECK(divider >= 0, "Failed to calculate SPI clock divider");
  hal_spi_set_settings(hal_if, 0, static_cast<uint8_t>(divider), MSBFIRST, SPI_MODE0, nullptr);

  // CS high (inactive) initially
  PW_TRY(cs_.SetState(pw::digital_io::State::kActive));

  // Hardware reset
  HardwareReset();

  // Turn on backlight
  PW_TRY(bl_.SetState(pw::digital_io::State::kActive));

  PW_LOG_INFO("ST7789 hardware initialized");
  return pw::OkStatus();
}

pw::Result<lv_display_t*> PicoRes28LcdDriver::CreateLvglDisplay() {
  // Temporary storage for `this` pointer during lv_lcd_generic_mipi_create.
  // LVGL calls send_cmd_cb before we can set user_data.
  static PicoRes28LcdDriver* init_driver = nullptr;

  PW_CHECK_PTR_EQ(init_driver, nullptr, "CreateLvglDisplay is not reentrant");
  init_driver = this;

  // Use LVGL's generic MIPI LCD driver which handles the init sequence
  display_ = lv_lcd_generic_mipi_create(
      kWidth,
      kHeight,
      LV_LCD_FLAG_MIRROR_X | LV_LCD_FLAG_MIRROR_Y,

      [](auto* disp, auto* cmd, auto cmd_size, auto* param, auto param_size) {
        // Use user_data if set, otherwise fall back to init_driver
        auto* self =
            static_cast<PicoRes28LcdDriver*>(lv_display_get_user_data(disp));
        if (self == nullptr) {
          self = init_driver;
        }
        PW_CHECK_NOTNULL(self);
        self->SendCommand(AsBytes(cmd, cmd_size), AsBytes(param, param_size));
      },
      []([[maybe_unused]] auto* disp,
         [[maybe_unused]] auto* cmd,
         [[maybe_unused]] auto cmd_size,
         [[maybe_unused]] auto* param,
         [[maybe_unused]] auto param_size) {
        // Unused - flush callback is overridden below
      }
  );

  if (display_ == nullptr) {
    init_driver = nullptr;
    return pw::Status::Internal();
  }

  // Store this pointer for callbacks, then clear temporary storage
  lv_display_set_user_data(display_, this);
  init_driver = nullptr;

  // ST7789 typically needs inversion enabled
  lv_lcd_generic_mipi_set_invert(display_, true);

  // Override flush callback with our custom one for DMA transfers
  lv_display_set_flush_cb(display_, &PicoRes28LcdDriver::FlushCallback);

  // Set swapped RGB565 format (big-endian for ST7789)
  lv_display_set_color_format(display_, LV_COLOR_FORMAT_RGB565_SWAPPED);
  lv_display_set_buffers(
      display_,
      draw_buf1_,
      draw_buf2_,
      kBufferSize,
      LV_DISPLAY_RENDER_MODE_PARTIAL
  );

  // Start flush thread
  PW_LOG_INFO("Starting display flush thread");
  flush_thread_.emplace(
      thread_options_,
      [this]() { FlushThreadMain(); }
  );
  flush_thread_->detach();

  return display_;
}

void PicoRes28LcdDriver::SendCommand(
    pw::ConstByteSpan cmd, pw::ConstByteSpan data
) {
  PW_CHECK(!cmd.empty(), "SendCommand requires non-empty command");

  const auto hal_if = static_cast<hal_spi_interface_t>(hal_spi_interface_);

  // CS low (select)
  (void)cs_.SetState(pw::digital_io::State::kInactive);

  // DC low = command, send via blocking transfer
  (void)dc_.SetState(pw::digital_io::State::kInactive);
  for (size_t i = 0; i < cmd.size(); ++i) {
    hal_spi_transfer(hal_if, static_cast<uint16_t>(cmd[i]));
  }

  // DC high = data (optional)
  if (!data.empty()) {
    (void)dc_.SetState(pw::digital_io::State::kActive);
    for (size_t i = 0; i < data.size(); ++i) {
      hal_spi_transfer(hal_if, static_cast<uint16_t>(data[i]));
    }
  }

  // CS high (deselect)
  (void)cs_.SetState(pw::digital_io::State::kActive);
}

void PicoRes28LcdDriver::FlushCallback(
    lv_display_t* disp, const lv_area_t* area, uint8_t* px_map
) {
  auto* self = static_cast<PicoRes28LcdDriver*>(lv_display_get_user_data(disp));
  const size_t pixel_count = lv_area_get_size(area);
  const size_t byte_count = pixel_count * 2;  // RGB565 = 2 bytes per pixel

  metrics::OnFlushRegion(area->x2 - area->x1 + 1, area->y2 - area->y1 + 1);

  FlushRequest request{
      .area = *area,
      .px_map = px_map,
      .byte_count = byte_count,
  };

  // Post to flush thread via DeviceOS queue
  int result = os_queue_put(
      self->flush_queue_, &request, CONCURRENT_WAIT_FOREVER, nullptr);
  if (result != 0) {
    PW_LOG_ERROR("Failed to queue flush request!");
    lv_display_flush_ready(disp);
    return;
  }

  // Wait for flush thread to complete processing
  os_semaphore_take(self->flush_done_, CONCURRENT_WAIT_FOREVER, false);

  // Call flush_ready from MAIN thread (same thread as lv_timer_handler)
  // LVGL requires flush_ready to be called from the same thread context.
  lv_display_flush_ready(disp);
}

void PicoRes28LcdDriver::HardwareReset() {
  using namespace std::chrono_literals;

  // Reset sequence: HIGH -> LOW -> HIGH
  (void)rst_.SetState(pw::digital_io::State::kActive);
  pw::this_thread::sleep_for(50ms);
  (void)rst_.SetState(pw::digital_io::State::kInactive);
  pw::this_thread::sleep_for(50ms);
  (void)rst_.SetState(pw::digital_io::State::kActive);
  pw::this_thread::sleep_for(150ms);
}

void PicoRes28LcdDriver::DmaCallback() {
  // Note: This runs in ISR context - don't log here
  if (g_dma_instance != nullptr) {
    os_semaphore_give(g_dma_instance->dma_complete_, false);
  }
}

void PicoRes28LcdDriver::FlushThreadMain() {
  PW_LOG_INFO("Display flush thread started");

  while (true) {
    // Wait for flush request from LVGL callback
    FlushRequest request;
    int result = os_queue_take(flush_queue_, &request, CONCURRENT_WAIT_FOREVER, nullptr);
    if (result != 0) {
      continue;  // Shouldn't happen with WAIT_FOREVER
    }

    // Process the request (SPI/DMA transfer)
    ProcessFlushRequest(request);

    // Signal main thread that flush is complete
    os_semaphore_give(flush_done_, false);
  }
}

void PicoRes28LcdDriver::ProcessFlushRequest(const FlushRequest& request) {
  // Cast to uint16_t for MIPI DCS 2-byte coordinate format
  const uint16_t x1 = static_cast<uint16_t>(request.area.x1);
  const uint16_t y1 = static_cast<uint16_t>(request.area.y1);
  const uint16_t x2 = static_cast<uint16_t>(request.area.x2);
  const uint16_t y2 = static_cast<uint16_t>(request.area.y2);

  // Encode coordinates as big-endian bytes
  const std::array<std::byte, 4> column_data = {
      static_cast<std::byte>(x1 >> 8),
      static_cast<std::byte>(x1 & 0xFF),
      static_cast<std::byte>(x2 >> 8),
      static_cast<std::byte>(x2 & 0xFF),
  };
  const std::array<std::byte, 4> row_data = {
      static_cast<std::byte>(y1 >> 8),
      static_cast<std::byte>(y1 & 0xFF),
      static_cast<std::byte>(y2 >> 8),
      static_cast<std::byte>(y2 & 0xFF),
  };

  const auto hal_if = static_cast<hal_spi_interface_t>(hal_spi_interface_);

  // Send CASET and RASET (small, blocking is OK)
  SendCommand(kCmdColumnAddressSet, column_data);
  SendCommand(kCmdRowAddressSet, row_data);

  // Send RAMWR command header
  // CS low (select)
  (void)cs_.SetState(pw::digital_io::State::kInactive);

  // DC low = command
  (void)dc_.SetState(pw::digital_io::State::kInactive);
  hal_spi_transfer(hal_if, static_cast<uint16_t>(kCmdMemoryWrite[0]));

  // DC high = data
  (void)dc_.SetState(pw::digital_io::State::kActive);

  // Send pixel data via DMA with timeout/cancel
  SendPixelDataDma(AsBytes(request.px_map, request.byte_count));

  // CS high (deselect)
  (void)cs_.SetState(pw::digital_io::State::kActive);
}

void PicoRes28LcdDriver::SendPixelDataDma(pw::ConstByteSpan pixels) {
  const auto hal_if = static_cast<hal_spi_interface_t>(hal_spi_interface_);

  // Drain any stale callback from previous timed-out transfer
  (void)os_semaphore_take(dma_complete_, 0, false);

  // Start DMA transfer
  hal_spi_transfer_dma(
      hal_if,
      pixels.data(),
      nullptr,  // No read buffer
      static_cast<uint32_t>(pixels.size()),
      &PicoRes28LcdDriver::DmaCallback
  );

  // Wait for completion with timeout (kDmaTimeoutMs milliseconds)
  int result = os_semaphore_take(dma_complete_, kDmaTimeoutMs, false);

  if (result != 0) {
    // DMA hung - cancel and count it
    ++dma_hang_count_;
    metrics::OnDmaHang();
    PW_LOG_WARN(
        "DMA transfer timed out (hang count: %lu)",
        static_cast<unsigned long>(dma_hang_count_)
    );
    hal_spi_transfer_dma_cancel(hal_if);

    // Drain any late callback
    (void)os_semaphore_take(dma_complete_, 0, false);
  }
}

}  // namespace maco::display
