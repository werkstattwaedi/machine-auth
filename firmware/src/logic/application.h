#pragma once

#include "common.h"
#include "logic/cloud_request.h"
#include "logic/configuration.h"
#include "logic/session/sessions.h"

namespace oww::logic {

class Application : public std::enable_shared_from_this<Application> {
 public:
  Application(std::unique_ptr<Configuration> configuration);

  Status Begin();

  void Loop();

  Configuration* GetConfiguration() { return configuration_.get(); }

  session::Sessions& GetSessions() { return sessions_; }
  session::MachineUsage& GetMachineUsage() { return machine_usage_; }

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

  std::unique_ptr<Configuration> configuration_;
  CloudRequest cloud_request_;
  session::Sessions sessions_;
  session::MachineUsage machine_usage_;
};

}  // namespace oww::logic