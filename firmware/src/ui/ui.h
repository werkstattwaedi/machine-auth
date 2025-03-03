#pragma once

#include <XPT2046_Touch.h>
#include <lvgl.h>

#include "common.h"
#include "splashscreen.h"
#include "tagstatus.h"
#include "state/state.h"
#include "statusbar.h"

namespace oww::ui {

enum class Error : int {
  kUnspecified = 0,
  kIllegalState = 1,
  kIllegalArgument = 2,
};

class UserInterface {
 public:
  static UserInterface &instance();

  tl::expected<void, Error> Begin(std::shared_ptr<oww::state::State> state);

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
  // UserInterface is a singleton - use UserInterface.instance()
  static UserInterface *instance_;
  UserInterface();

  virtual ~UserInterface();
  UserInterface(const UserInterface &) = delete;
  UserInterface &operator=(const UserInterface &) = delete;

  static Logger logger;

  Thread *thread_ = nullptr;
  os_mutex_t mutex_ = 0;

  std::shared_ptr<oww::state::State> state_ = nullptr;

  os_thread_return_t UserInterfaceThread();

  void UpdateGui();

 private:
  std::unique_ptr<SplashScreen> splash_screen_ = nullptr;
  std::unique_ptr<StatusBar> status_bar_ = nullptr;
  std::unique_ptr<TagStatus> tag_status_ = nullptr;
};

}  // namespace oww::ui
