// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pico_res28_lcd/pico_res28_lcd_driver.h"

#include <drivers/display/lcd/lv_lcd_generic_mipi.h>

#include "pw_assert/check.h"
#include "pw_bytes/array.h"
#include "pw_bytes/endian.h"
#include "pw_log/log.h"
#include "pw_thread/sleep.h"

namespace maco::display {

namespace {

// SPI Mode 0 config for ST7789
const pw::spi::Config kSpiConfig = {
    .polarity = pw::spi::ClockPolarity::kActiveHigh,
    .phase = pw::spi::ClockPhase::kRisingEdge,
    .bits_per_word = pw::spi::BitsPerWord(8),
    .bit_order = pw::spi::BitOrder::kMsbFirst,
};

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

PicoRes28LcdDriver::PicoRes28LcdDriver(
    pw::spi::Initiator& spi,
    pw::digital_io::DigitalOut& cs,
    pw::digital_io::DigitalOut& dc,
    pw::digital_io::DigitalOut& rst,
    pw::digital_io::DigitalOut& bl
)
    : spi_(spi), cs_(cs), dc_(dc), rst_(rst), bl_(bl) {}

pw::Status PicoRes28LcdDriver::Init() {
  PW_LOG_INFO("Initializing ST7789 display (%dx%d)", kWidth, kHeight);

  // Enable GPIO pins
  PW_TRY(cs_.Enable());
  PW_TRY(dc_.Enable());
  PW_TRY(rst_.Enable());
  PW_TRY(bl_.Enable());

  // Configure SPI for Mode 0, MSB first
  PW_TRY(spi_.Configure(kSpiConfig));

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
        self->SendData(AsBytes(cmd, cmd_size), AsBytes(param, param_size));
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

  // Verify color format is RGB565 (2 bytes per pixel) - buffer size assumes
  // this
  PW_CHECK_INT_EQ(
      lv_color_format_get_size(lv_display_get_color_format(display_)),
      2,
      "Expected RGB565 color format"
  );

  lv_display_set_buffers(
      display_,
      draw_buf1_,
      draw_buf2_,
      kBufferSize,
      LV_DISPLAY_RENDER_MODE_PARTIAL
  );

  return display_;
}

void PicoRes28LcdDriver::SendData(
    pw::ConstByteSpan cmd, pw::ConstByteSpan data
) {
  // CS low (select)
  (void)cs_.SetState(pw::digital_io::State::kInactive);

  // DC low = command
  if (!cmd.empty()) {
    (void)dc_.SetState(pw::digital_io::State::kInactive);
    (void)spi_.WriteRead(cmd, pw::ByteSpan());
  }

  // DC high = data
  if (!data.empty()) {
    (void)dc_.SetState(pw::digital_io::State::kActive);
    (void)spi_.WriteRead(data, pw::ByteSpan());
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
  self->Flush(area, AsBytes(px_map, byte_count));
  lv_display_flush_ready(disp);
}

void PicoRes28LcdDriver::Flush(
    const lv_area_t* area, pw::ConstByteSpan pixels
) {
  // Set column address (CASET)
  SendData(
      kCmdColumnAddressSet,
      pw::bytes::Concat(
          /* start */ pw::bytes::CopyInOrder(pw::endian::big, area->x1),
          /* end */ pw::bytes::CopyInOrder(pw::endian::big, area->x2)
      )
  );

  // Set row address (RASET)
  SendData(
      kCmdRowAddressSet,
      pw::bytes::Concat(
          /* start */ pw::bytes::CopyInOrder(pw::endian::big, area->y1),
          /* end */ pw::bytes::CopyInOrder(pw::endian::big, area->y2)
      )
  );

  // Memory write (RAMWR) + pixel data
  SendData(kCmdMemoryWrite, pixels);
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

}  // namespace maco::display
