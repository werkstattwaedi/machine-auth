#include "display.h"

#include <concurrent_hal.h>
#include <drivers/display/lcd/lv_lcd_generic_mipi.h>

#include "Particle.h"
#include "config.h"
#include "state/configuration.h"

// clang-format on

using namespace config::ui::display;

Logger display_log("display");

Display *Display::instance_;
uint32_t Display::transfer_count_ = 0;

Display &Display::instance() {
  if (!instance_) {
    instance_ = new Display();
  }
  return *instance_;
}

Display::Display()
    : spi_interface_(SPI1),
      spi_settings_(40 * MHZ, MSBFIRST, SPI_MODE0),
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

  os_queue_create(&flush_queue_, sizeof(DisplayFlushRequest), 1, NULL);
  os_semaphore_create(&dma_complete_semaphore_, /*max_count=*/1,
                      /*initial_count=*/0);
  spi_flush_thread_ = new Thread(
      "spi_flush", [this]() { SpiFlushThread(); }, OS_THREAD_PRIORITY_DEFAULT + 1);

  lv_init();
#if LV_USE_LOG
  lv_log_register_print_cb(
      [](lv_log_level_t level, const char *buf) { display_log.print(buf); });
#endif
  lv_tick_set_cb([]() { return millis(); });

  display_ = lv_lcd_generic_mipi_create(
      resolution_horizontal, resolution_vertical,
      LV_LCD_FLAG_MIRROR_X | LV_LCD_FLAG_MIRROR_Y,
      [](auto *disp, auto *cmd, auto cmd_size, auto *param, auto param_size) {
        Display::instance().SendCommand(cmd, cmd_size, param, param_size);
      },
      [](auto *disp, auto *cmd, auto cmd_size, auto *param, auto param_size) {
        // Unused
      });

  lv_lcd_generic_mipi_set_invert(display_, true);

  // Set our custom flush callback
  lv_display_set_flush_cb(
      display_, [](lv_display_t *disp, const lv_area_t *area, uint8_t *px_map) {
        auto request = DisplayFlushRequest{
            .area = *area,
            .px_map = px_map,
        };
        os_queue_put(Display::instance_->flush_queue_, &request,
                     CONCURRENT_WAIT_FOREVER, NULL);
      });

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

  // touchscreen_interface_.begin();

  lv_indev_t *indev = lv_indev_create();
  lv_indev_set_type(
      indev, LV_INDEV_TYPE_POINTER); /* Touch pad is a pointer-like device. */
  lv_indev_set_read_cb(indev, [](auto indev, auto data) {
    Display::instance().ReadTouchInput(indev, data);
  });

  return Status::kOk;
}

void Display::RenderLoop() {
  uint32_t time_till_next = lv_timer_handler();
  delay(time_till_next);
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

// SPI flush thread - handles all SPI transfers
void Display::SpiFlushThread() {
  display_log.error("Flush thread started");

  while (true) {
    DisplayFlushRequest request;
    loop1++;
    if (os_queue_take(flush_queue_, &request, CONCURRENT_WAIT_FOREVER, NULL) !=
        0) {
      loopX++;
      continue;
    }
    loop2++;
    ProcessFlushRequest(request);
    loop3++;
  }
}

void Display::SendAddressCommand(uint8_t cmd, int32_t start, int32_t end) {
  pinResetFast(pin_datacommand);
  spi_interface_.transfer(cmd);
  pinSetFast(pin_datacommand);
  spi_interface_.transfer((start >> 8) & 0xFF);
  spi_interface_.transfer(start & 0xFF);
  spi_interface_.transfer(((end - 1) >> 8) & 0xFF);
  spi_interface_.transfer((end - 1) & 0xFF);
}

// Process flush request in SPI thread
void Display::ProcessFlushRequest(const DisplayFlushRequest &request) {
  transfer_count_++;
  flushS++;
  auto drv =
      (lv_lcd_generic_mipi_driver_t *)lv_display_get_driver_data(display_);

  int32_t x_start = request.area.x1 + drv->x_gap;
  int32_t x_end = request.area.x2 + 1 + drv->x_gap;
  int32_t y_start = request.area.y1 + drv->y_gap;
  int32_t y_end = request.area.y2 + 1 + drv->y_gap;

  LV_ASSERT((x_start < x_end) && (y_start < y_end) &&
            "start position must be smaller than end position");

  // Start SPI transaction (safe in this dedicated thread)
  flush1++;
  spi_interface_.beginTransaction(spi_settings_);
  flush2++;
  pinResetFast(pin_chipselect);
  flush3++;

  /* define an area of frame memory where MCU can access */
  SendAddressCommand(LV_LCD_CMD_SET_COLUMN_ADDRESS, x_start, x_end);
  flush4++;
  SendAddressCommand(LV_LCD_CMD_SET_PAGE_ADDRESS, y_start, y_end);
  flush5++;

  /* transfer frame buffer */

  size_t len = (x_end - x_start) * (y_end - y_start) *
               lv_color_format_get_size(lv_display_get_color_format(display_));

  // Particles SPI does not let us flush the words in the reverse order, so
  // flipping the buffer ahead of time in memory.
  // TODO measure if things can be effectively speed up by swapping and flushing
  // smaller blocks in parallel.
  lv_draw_sw_rgb565_swap(request.px_map, lv_area_get_size(&request.area));

  pinResetFast(pin_datacommand);

  spi_interface_.transfer(LV_LCD_CMD_WRITE_MEMORY_START);
  pinSetFast(pin_datacommand);
  flush6++;

  spi_interface_.transfer(request.px_map, NULL, len, [] {
    Display::instance_->flush7++;

    // Signal DMA complete callback and semaphore, rather than NULL callback:
    // The null callback will busy way, burning through precious cycles.
    os_semaphore_give(Display::instance_->dma_complete_semaphore_, false);
  });
  flush8++;

  if (os_semaphore_take(dma_complete_semaphore_, 20, false) != 0 ) {
    flushX++;
    spi_interface_.transferCancel();
  }

  flush9++;

  pinSetFast(pin_chipselect);
  flush10++;
  spi_interface_.endTransaction();
  flush11++;

  lv_display_flush_ready(display_);
  flush12++;
}
