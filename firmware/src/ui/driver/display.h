#pragma once

#include <XPT2046_Touch.h>
#include <lvgl.h>

#include "common.h"
#include "state/state.h"

struct DisplayFlushRequest {
  lv_area_t area;
  uint8_t *px_map;
};

class Display {
 public:
  static Display &instance();

  Status Begin();

  void RenderLoop();

  static uint32_t GetTransferCount() { return transfer_count_; }

 private:
  // Display is a singleton - use Display.instance()
  static Display *instance_;
  Display();

  virtual ~Display();
  Display(const Display &) = delete;
  Display &operator=(const Display &) = delete;

  lv_display_t *display_ = nullptr;
  lv_indev_t *touch_input = nullptr;

  SPIClass &spi_interface_;
  SPISettings spi_settings_;
  XPT2046_Touchscreen touchscreen_interface_;

  void ReadTouchInput(lv_indev_t *indev, lv_indev_data_t *data);

  // Sends generic display command.
  // begins/ends SPI transaction
  void SendCommand(const uint8_t *cmd, size_t cmd_size, const uint8_t *param,
                   size_t param_size);

  // SPI Flush Thread Implementation
  void SpiFlushThread();
  void ProcessFlushRequest(const DisplayFlushRequest &request);
  void SendAddressCommand(uint8_t cmd, int32_t start, int32_t end);
  Thread *spi_flush_thread_;
  os_queue_t flush_queue_;
  os_semaphore_t dma_complete_semaphore_;

  // Transfer state tracking
  static uint32_t transfer_count_;

  // Make these accessible to the static thread function
  SPIClass &GetSpiInterface() { return spi_interface_; }
  SPISettings &GetSpiSettings() { return spi_settings_; }
};
