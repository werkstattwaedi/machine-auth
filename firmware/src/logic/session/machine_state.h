#pragma once

#include <chrono>
#include <map>
#include <vector>

#include "common.h"
#include "fbs/ledger_terminal-config_generated.h"
#include "fbs/machine_usage_generated.h"
#include "fbs/token_session_generated.h"
#include "state/machine_state.h"
#include "state/tag_state.h"
#include "state/token_session.h"

namespace oww::logic {
class Application;

namespace session {

class MachineUsage {
  static Logger logger;

  using MachineStateHandle = oww::state::MachineStateHandle;
  using MachineStateMachine = oww::state::MachineStateMachine;

 public:
  MachineUsage(oww::logic::Application* state);
  void Begin(const fbs::Machine& machine);

  // Takes tag state as input, returns machine state
  MachineStateHandle Loop(const oww::state::TagStateHandle& tag_state);

  // Thread-safe state query (for UI)
  MachineStateHandle GetState() const {
    return state_machine_->GetStateHandle();
  }

  // Manual checkout (UI button)
  tl::expected<void, ErrorType> ManualCheckOut();

  tl::expected<void, ErrorType> CheckIn(
      std::shared_ptr<oww::state::TokenSession> session);

  template <typename T>
  tl::expected<void, ErrorType> CheckOut(std::unique_ptr<T> checkout_reason);

 private:
  void RegisterStateHandlers();

  // State machine handlers
  MachineStateMachine::StateOpt OnIdle(state::machine::Idle& state);
  MachineStateMachine::StateOpt OnActive(state::machine::Active& state);
  MachineStateMachine::StateOpt OnDenied(state::machine::Denied& state);

  oww::logic::Application* app_;

  std::string machine_id_;
  std::vector<std::string> required_permissions_;

  std::shared_ptr<MachineStateMachine> state_machine_;
  std::optional<oww::state::session_creation::SessionCreationStateHandle> last_session_create_state_;

  fbs::MachineUsageHistoryT usage_history_;

  std::string usage_history_logfile_path;

  PinState relais_state_ = LOW;

  void UpdateRelaisState();

  tl::expected<void, ErrorType> PersistHistory();
  void UploadHistory();
};

}  // namespace session
}  // namespace oww::logic
