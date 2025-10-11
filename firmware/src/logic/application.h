#pragma once

#include "common.h"
#include "logic/cloud_request.h"
#include "logic/configuration.h"
#include "logic/session/session_coordinator.h"
#include "logic/session/sessions.h"
#include "state/iapplication_state.h"

namespace oww::logic {

class Application : public state::IApplicationState,
                    public std::enable_shared_from_this<Application> {
 public:
  Application(std::unique_ptr<Configuration> configuration);

  Status Begin();

  void Loop();

  Configuration* GetConfiguration() { return configuration_.get(); }

  std::shared_ptr<CloudRequest> GetCloudRequest() { return cloud_request_; }
  std::shared_ptr<session::Sessions> GetSessions() { return sessions_; }
  session::MachineUsage& GetMachineUsage() { return machine_usage_; }
  session::SessionCoordinator& GetSessionCoordinator() {
    return session_coordinator_;
  }

  // IApplicationState implementation
  state::SystemStateHandle GetSystemState() const override;
  state::SessionStateHandle GetSessionState() const override;
  state::MachineStateHandle GetMachineState() const override;
  tl::expected<void, ErrorType> RequestManualCheckOut() override;
  void RequestCancelCurrentOperation() override;

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

  // Shared ownership for actions/callbacks
  std::shared_ptr<CloudRequest> cloud_request_;
  std::shared_ptr<session::Sessions> sessions_;

  // Stack members (no shared ownership needed)
  session::SessionCoordinator session_coordinator_;
  session::MachineUsage machine_usage_;
};

}  // namespace oww::logic