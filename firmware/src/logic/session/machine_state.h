#pragma once

#include <chrono>
#include <map>
#include <vector>

#include "common.h"
#include "common/state_machine.h"
#include "fbs/ledger_terminal-config_generated.h"
#include "fbs/machine_usage_generated.h"
#include "fbs/token_session_generated.h"
#include "token_session.h"

namespace oww::logic {
class Application;

namespace session {

namespace machine_state {
struct Idle {};

struct Active {
  std::shared_ptr<TokenSession> session;
  std::chrono::time_point<std::chrono::system_clock> start_time;
};

struct Denied {
  std::string message;
  std::chrono::time_point<std::chrono::system_clock> time;
};

}  // namespace machine_state

using MachineStateMachine =
    oww::common::StateMachine<machine_state::Idle, machine_state::Active,
                              machine_state::Denied>;
using StateHandle = MachineStateMachine::StateHandle;

class MachineUsage {
  static Logger logger;

 public:
  MachineUsage(oww::logic::Application* state);
  void Begin(const fbs::Machine& machine);
  void Loop();

  StateHandle GetState() { return state_machine_->GetStateHandle(); }

  tl::expected<void, ErrorType> CheckIn(std::shared_ptr<TokenSession> session);

  template <typename T>
  tl::expected<void, ErrorType> CheckOut(std::unique_ptr<T> checkout_reason);

 private:
  void RegisterStateHandlers();

  // State machine handlers
  MachineStateMachine::StateOpt OnIdle(machine_state::Idle& state);
  MachineStateMachine::StateOpt OnActive(machine_state::Active& state);
  MachineStateMachine::StateOpt OnDenied(machine_state::Denied& state);

  oww::logic::Application* app_;

  std::string machine_id_;
  std::vector<std::string> required_permissions_;

  std::shared_ptr<MachineStateMachine> state_machine_;
  fbs::MachineUsageHistoryT usage_history_;

  std::string usage_history_logfile_path;

  PinState relais_state_ = LOW;

  void UpdateRelaisState();

  tl::expected<void, ErrorType> PersistHistory();
  void UploadHistory();
};

}  // namespace session
}  // namespace oww::logic
