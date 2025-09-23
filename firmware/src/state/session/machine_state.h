#pragma once

#include <chrono>
#include <map>
#include <vector>

#include "common.h"
#include "fbs/ledger_terminal-config_generated.h"
#include "fbs/machine_usage_generated.h"
#include "fbs/token_session_generated.h"
#include "token_session.h"

namespace oww::state {
class State;

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

using MachineState = std::variant<machine_state::Idle, machine_state::Active,
                                  machine_state::Denied>;

class MachineUsage {
  static Logger logger;

 public:
  MachineUsage(const fbs::Machine &machine);
  void Begin(std::shared_ptr<oww::state::State> state);
  void Loop();

  MachineState GetMachineState() { return current_state_; }

  tl::expected<MachineState, ErrorType> CheckIn(
      std::shared_ptr<TokenSession> session);

  template <typename T>
  tl::expected<MachineState, ErrorType> CheckOut(
      std::unique_ptr<T> checkout_reason);

 private:
  std::shared_ptr<oww::state::State> state_ = nullptr;

  std::string machine_id_;
  std::vector<std::string> required_permissions_;

  MachineState current_state_;
  fbs::MachineUsageHistoryT usage_history_;

  std::string usage_history_logfile_path;

  tl::expected<void, ErrorType> PersistHistory();
  void UploadHistory();
};

}  // namespace session
}  // namespace oww::state
