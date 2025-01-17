#pragma once

#include "libbase.h"
#include "lvgl.h"

#define DISPLAY_LOGTAG "Display"
#define DISPLAY_H_RES 240
#define DISPLAY_V_RES 320

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
  Display(uint8_t reset_pin, uint8_t chipselect_pin, uint8_t datacommand_pin,
          uint8_t backlight_pin);

  virtual ~Display();
  Display(const Display &) = delete;
  Display &operator=(const Display &) = delete;

  Thread *thread_ = nullptr;
  os_mutex_t mutex_ = 0;

  lv_display_t *display_ = nullptr;
  SPISettings spi_settings_;
  int8_t reset_pin_;
  int8_t chipselect_pin_;
  int8_t datacommand_pin_;
  int8_t backlight_pin_;

  os_thread_return_t DisplayThreadFunction();

    void RenderFrame();


  void SendCommandDirect(const uint8_t *cmd, size_t cmd_size,
                         const uint8_t *param, size_t param_size);
  void SendCommandDma(const uint8_t *cmd, size_t cmd_size, const uint8_t *param,
                      size_t param_size);
};
