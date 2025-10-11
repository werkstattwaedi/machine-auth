#pragma once

#include <XPT2046_Touch.h>
#include <lvgl.h>

#include <array>

#include "drivers/touch/cap1296.h"
#include "common.h"

namespace oww::drivers::display {

struct DisplayFlushRequest {
  lv_area_t area;
  uint8_t* px_map;
};

class Display {
 public:
  static Display& instance();

  Status Begin();

  void RenderLoop();
  // Button mapping system for physical buttons to touch positions
  void SetButtonMapping(uint8_t button_id, lv_point_t position);

 private:
  // Display is a singleton - use Display.instance()
  static Display* instance_;
  Display();

  virtual ~Display();
  Display(const Display&) = delete;
  Display& operator=(const Display&) = delete;

  lv_display_t* display_ = nullptr;
  lv_indev_t* touch_input = nullptr;

  SPIClass& spi_interface_;
  SPISettings spi_settings_;
  XPT2046_Touchscreen touchscreen_interface_;
  oww::drivers::touch::CAP1296 cap_interface_;

  void ReadTouchInput(lv_indev_t* indev, lv_indev_data_t* data);

  // Button state tracking for buffered reading
  uint8_t last_buttons_state_ = 0;

  // Button mapping storage (button_id -> touch position)
  std::array<lv_point_t, 6> button_mappings_ = {};

  // Sends generic display command.
  void SendCommand(const uint8_t* cmd, size_t cmd_size, const uint8_t* param,
                   size_t param_size);

  // SPI Flush Thread Implementation
  void SpiFlushThread();
  void ProcessFlushRequest(const DisplayFlushRequest& request);
  void SendAddressCommand(uint8_t cmd, int32_t start, int32_t end);
  Thread* spi_flush_thread_;
  os_queue_t flush_queue_;
  os_semaphore_t dma_complete_semaphore_;

  volatile uint32_t frame_count_ = 0;
  volatile uint32_t transfer_count_ = 0;
  volatile uint32_t transfer_hang_count_ = 0;
};

}  // namespace oww::drivers::display
