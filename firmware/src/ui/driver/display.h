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
  void LogStat() {
    Log.warn("loop\n 1: %d\n 2: %d\n 3: %d\n X: %d", loop1, loop2, loop3,
             loopX);
    Log.warn(
        "f\n S: %d\n 1: %d\n 2: %d\n 3: %d\n 4: %d\n 5: %d\n 6: %d\n 7: %d\n "
        "8: %d\n 9: %d\n 10: %d\n 11: %d\n 12: %d\n E: %d",
        flushS, flush1, flush2, flush3, flush4, flush5, flush6, flush7, flush8,
        flush9, flush10, flush11, flush12, flushE);
  }

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
  volatile uint32_t loop1 = 0;
  volatile uint32_t loop2 = 0;
  volatile uint32_t loop3 = 0;
  volatile uint32_t loopX = 0;

  volatile uint32_t flushS = 0;
  volatile uint32_t flush1 = 0;
  volatile uint32_t flush2 = 0;
  volatile uint32_t flush3 = 0;
  volatile uint32_t flush4 = 0;
  volatile uint32_t flush5 = 0;
  volatile uint32_t flush6 = 0;
  volatile uint32_t flush7 = 0;
  volatile uint32_t flush8 = 0;
  volatile uint32_t flush9 = 0;
  volatile uint32_t flush10 = 0;
  volatile uint32_t flush11 = 0;
  volatile uint32_t flush12 = 0;
  volatile uint32_t flushE = 0;

  // Make these accessible to the static thread function
  SPIClass &GetSpiInterface() { return spi_interface_; }
  SPISettings &GetSpiSettings() { return spi_settings_; }
};
