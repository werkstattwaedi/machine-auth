#pragma once

#include "cloud_request.h"
#include "common.h"
#include "configuration.h"
#include "event/state_event.h"
#include "terminal/state.h"

namespace oww::state {

class State : public event::IStateEvent, public CloudRequest {
 public:
State();

  Status Begin(std::unique_ptr<Configuration> configuration);

  void Loop();

  Configuration* GetConfiguration() { return configuration_.get(); }

  std::shared_ptr<terminal::State> GetTerminalState() {
    return terminal_state_;
  }

 public:
  os_mutex_t mutex_ = 0;
  void lock() { os_mutex_lock(mutex_); };
  bool tryLock() { return os_mutex_trylock(mutex_); };
  void unlock() { os_mutex_unlock(mutex_); };

  void SetBootProgress(std::string message);
  void BootCompleted();
  bool IsBootCompleted();
  std::string GetBootProgress();

 private:
  static Logger logger;

  std::string boot_progress_;

  std::unique_ptr<Configuration> configuration_ = nullptr;
  std::shared_ptr<terminal::State> terminal_state_;

 public:
  virtual void OnConfigChanged() override;

  virtual void OnTagFound() override;
  virtual void OnBlankNtag(std::array<uint8_t, 7> uid) override;
  virtual void OnUnknownTag() override;
  virtual void OnTagRemoved() override;
  virtual void OnTagAuthenicated(std::array<uint8_t, 7> uid) override;
  virtual void OnNewState(oww::state::terminal::StartSession state) override;
  virtual void OnNewState(oww::state::terminal::Personalize state) override;
};

}  // namespace oww::state