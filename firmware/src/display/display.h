#pragma once

#include <XPT2046_Touch.h>

#include "libbase.h"
#include "lvgl.h"

class Display {
 public:
  static Display &instance();

  Status Begin();

  /**
   * @brief Locks the mutex that protects shared resources
   *
   * This is compatible with `WITH_LOCK(*this)`.
   *
   * The mutex is not recursive so do not lock it within a locked section.
   */
  void lock() { os_mutex_lock(mutex_); };

  /**
   * @brief Attempts to lock the mutex that protects shared resources
   *
   * @return true if the mutex was locked or false if it was busy already.
   */
  bool tryLock() { return os_mutex_trylock(mutex_); };

  /**
   * @brief Unlocks the mutex that protects shared resources
   */
  void unlock() { os_mutex_unlock(mutex_); };

 private:
  // Display is a singleton - use Display.instance()
  static Display *instance_;
  Display();

  virtual ~Display();
  Display(const Display &) = delete;
  Display &operator=(const Display &) = delete;

  Thread *thread_ = nullptr;
  os_mutex_t mutex_ = 0;

  lv_display_t *display_ = nullptr;
  lv_indev_t *touch_input = nullptr;

  SPIClass &spi_interface_;
  SPISettings spi_settings_;
  XPT2046_Touchscreen touchscreen_interface_;

  os_thread_return_t DisplayThreadFunction();

  void RenderFrame();

  void SendCommandDirect(const uint8_t *cmd, size_t cmd_size,
                         const uint8_t *param, size_t param_size);
  void SendCommandDma(const uint8_t *cmd, size_t cmd_size, const uint8_t *param,
                      size_t param_size);

  void ReadTouchInput(lv_indev_t *indev, lv_indev_data_t *data);
};
