#include "display.h"

#include <drivers/display/lcd/lv_lcd_generic_mipi.h>

#include "config.h"
#include "state/configuration.h"

// clang-format on

using namespace config::ui::display;

Logger display_log("display");

Display *Display::instance_;

Display &Display::instance() {
  if (!instance_) {
    instance_ = new Display();
  }
  return *instance_;
}

Display::Display()
    : spi_interface_(SPI1),
      spi_settings_(50 * MHZ, MSBFIRST, SPI_MODE0),
      touchscreen_interface_(SPI1, resolution_horizontal, resolution_vertical,
                             pin_touch_chipselect, pin_touch_irq) {}

Display::~Display() {}

Status Display::Begin() {
  pinMode(pin_reset, OUTPUT);
  pinMode(pin_chipselect, OUTPUT);
  pinMode(pin_datacommand, OUTPUT);
  pinMode(pin_backlight, OUTPUT);

  spi_interface_.begin();

  digitalWrite(pin_backlight, HIGH);
  digitalWrite(pin_reset, HIGH);

  delay(200);
  digitalWrite(pin_reset, LOW);
  delay(200);
  digitalWrite(pin_reset, HIGH);
  delay(200);

  lv_init();
#if LV_USE_LOG
  lv_log_register_print_cb(
      [](lv_log_level_t level, const char *buf) { display_log.print(buf); });
#endif
  lv_tick_set_cb([]() { return millis(); });

  display_ = lv_lcd_generic_mipi_create(
      resolution_horizontal, resolution_vertical, LV_LCD_FLAG_NONE,
      [](auto *disp, auto *cmd, auto cmd_size, auto *param, auto param_size) {
        Display::instance().SendCommand(cmd, cmd_size, param, param_size);
      },
      [](auto *disp, auto *cmd, auto cmd_size, auto *param, auto param_size) {
        Display::instance().SendColor(cmd, cmd_size, param, param_size);
      });

  lv_lcd_generic_mipi_set_invert(display_, true);

  // FIXME: Photon2 has 3MB of RAM, so easily use 2 full size buffers
  // (~160k each), but for this, need to fix the render issues with
  // LV_DISPLAY_RENDER_MODE_DIRECT
  uint32_t buf_size =
      resolution_horizontal * resolution_vertical / 10 *
      lv_color_format_get_size(lv_display_get_color_format(display_));

  lv_color_t *buffer_1 = (lv_color_t *)malloc(buf_size);
  if (buffer_1 == NULL) {
    Log.error("display draw buffer malloc failed");
    return Status::kError;
  }

  lv_color_t *buffer_2 = (lv_color_t *)malloc(buf_size);
  if (buffer_2 == NULL) {
    Log.error("display buffer malloc failed");
    lv_free(buffer_1);
    return Status::kError;
  }

  lv_display_set_buffers(display_, buffer_1, buffer_2, buf_size,
                         LV_DISPLAY_RENDER_MODE_PARTIAL);

  touchscreen_interface_.begin();

  lv_indev_t *indev = lv_indev_create();
  lv_indev_set_type(
      indev, LV_INDEV_TYPE_POINTER); /* Touch pad is a pointer-like device. */
  lv_indev_set_read_cb(indev, [](auto indev, auto data) {
    Display::instance().ReadTouchInput(indev, data);
  });

  return Status::kOk;
}

os_thread_return_t Display::RenderLoop() {
  uint32_t time_till_next = lv_timer_handler();
  delay(time_till_next);
  display_log.info("Frame complete");
}

void Display::SendCommand(const uint8_t *cmd, size_t cmd_size,
                          const uint8_t *param, size_t param_size) {
  spi_interface_.beginTransaction(spi_settings_);

  pinResetFast(pin_chipselect);
  pinResetFast(pin_datacommand);

  for (size_t i = 0; i < cmd_size; i++) {
    spi_interface_.transfer(cmd[i]);
  }
  pinSetFast(pin_datacommand);

  for (size_t i = 0; i < param_size; i++) {
    spi_interface_.transfer(param[i]);
  }
  pinSetFast(pin_chipselect);

  spi_interface_.endTransaction();
}

void Display::SendColor(const uint8_t *cmd, size_t cmd_size,
                        const uint8_t *param, size_t param_size) {
  spi_interface_.beginTransaction(spi_settings_);
  pinResetFast(pin_chipselect);
  pinResetFast(pin_datacommand);

  for (size_t i = 0; i < cmd_size; i++) {
    spi_interface_.transfer(cmd[i]);
  }

  // FIXME - this should be done in the flush callback, rather than
  lv_draw_sw_rgb565_swap((void *)param, param_size / 2);

  pinSetFast(pin_datacommand);
  // if (param_size > 0) {
  //   spi_interface_.transfer(param, nullptr, param_size, nullptr);
  // }

  for (size_t i = 0; i < param_size; i++) {
    spi_interface_.transfer(param[i]);
  }
  pinSetFast(pin_chipselect);

  Display::instance_->spi_interface_.endTransaction();
  lv_display_flush_ready(Display::instance_->display_);
}

void Display::ReadTouchInput(lv_indev_t *indev, lv_indev_data_t *data) {
  // if (touchscreen_interface_.touched()) {
  //   TS_Point p = touchscreen_interface_.getPoint();
  //   auto x = map(p.x, 220, 3850, 1, 480);  //
  //   auto y = map(p.y, 310, 3773, 1, 320);  // Feel pretty good about this
  //   data->point.x = x;
  //   data->point.y = y;
  //   data->state = LV_INDEV_STATE_PR;

  // } else {
  data->state = LV_INDEV_STATE_REL;
  // }
}
