#pragma once

#include <XPT2046_Touch.h>
#include <lvgl.h>

#include "common.h"
#include "state/state.h"

class Display {
 public:
  static Display &instance();

  Status Begin();

  void RenderLoop();
  
  static uint32_t GetTransferCount() { return transfer_count_; }
  
  // Called from main loop to complete async SPI transfers
  void ProcessAsyncTransfers();

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

  void SendCommand(const uint8_t *cmd, size_t cmd_size,
                         const uint8_t *param, size_t param_size);
  void SendColor(const uint8_t *cmd, size_t cmd_size, const uint8_t *param,
                      size_t param_size);

  void ReadTouchInput(lv_indev_t *indev, lv_indev_data_t *data);

  // Callback-based SPI transfer methods
  void SendColorAsync(const uint8_t *cmd, size_t cmd_size, const uint8_t *param,
                      size_t param_size);
  static void SpiTransferCallback(void);
  void CompleteSpiTransfer(); // Called from main thread to complete the transfer
  
  // Transfer state tracking
  volatile bool transfer_complete_ = true;
  volatile bool transfer_error_ = false;
  volatile bool transfer_needs_completion_ = false;
  volatile uint32_t transfer_start_time_ = 0;
  static uint32_t transfer_count_;
};
