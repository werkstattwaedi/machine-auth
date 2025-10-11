#pragma once

#include <XPT2046_Touch.h>
#include <lvgl.h>

#include "buttonbar.h"
#include "common.h"
#include "drivers/leds/ws2812.h"
#include "logic/application.h"
#include "maincontent.h"
#include "neopixel.h"
#include "sessionstatus.h"
#include "splashscreen.h"
#include "statusbar.h"

namespace oww::ui {

enum class Error : int {
  kUnspecified = 0,
  kIllegalState = 1,
  kIllegalArgument = 2,
};

class UserInterface {
 public:
  static UserInterface& instance();

  tl::expected<void, Error> Begin(std::shared_ptr<oww::logic::Application> app);

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

  /** Push a new MainContent onto the stack, making it active */
  void PushContent(std::shared_ptr<MainContent> content);

  /** Pop the current MainContent from the stack, returning to the previous one
   */
  void PopContent();

  /** Get the currently active MainContent */
  std::shared_ptr<MainContent> GetCurrentContent();

  // Access to LED controller for UI components (SessionStatus, ButtonBar)
  drivers::leds::LedController* leds() { return led_.get(); }

 private:
  // UserInterface is a singleton - use UserInterface.instance()
  static UserInterface* instance_;
  UserInterface();

  virtual ~UserInterface();
  UserInterface(const UserInterface&) = delete;
  UserInterface& operator=(const UserInterface&) = delete;

  static Logger logger;

  Thread* thread_ = nullptr;
  os_mutex_t mutex_ = 0;

  std::shared_ptr<oww::logic::Application> app_ = nullptr;

  os_thread_return_t UserInterfaceThread();

  void UpdateGui();

  system_tick_t buzz_timeout = CONCURRENT_WAIT_FOREVER;
  void* last_buzz_state_id_ = nullptr;

  void UpdateBuzzer();
  void UpdateLed();

  // Set up button position mappings for touch input
  void SetupButtonMappings();

 private:
  Adafruit_NeoPixel led_strip_;
  std::unique_ptr<drivers::leds::LedController> led_;
  std::unique_ptr<SplashScreen> splash_screen_ = nullptr;
  std::unique_ptr<StatusBar> status_bar_ = nullptr;
  std::unique_ptr<ButtonBar> button_bar_ = nullptr;
  std::shared_ptr<SessionStatus> session_status_ = nullptr;
  std::vector<std::shared_ptr<MainContent>> content_stack_;

  void ActivateContent(std::shared_ptr<MainContent> content);
  void DeactivateCurrentContent();
};

}  // namespace oww::ui
