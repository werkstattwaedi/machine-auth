#pragma once

#include <chrono>
#include <map>
#include <vector>

#include "common.h"
#include "fbs/ledger_terminal-config_generated.h"
#include "fbs/machine_usage_generated.h"
#include "fbs/token_session_generated.h"
#include "token_session.h"

namespace oww::state::session {
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
  void Begin(const fbs::Machine& machine);
  void Loop();

  MachineState GetMachineState() { return current_state_; }

  tl::expected<MachineState, ErrorType> CheckIn(
      std::shared_ptr<TokenSession> session);

  template <typename T,
            typename = std::enable_if_t<
                std::is_same_v<T, fbs::ReasonUiT> ||
                std::is_same_v<T, fbs::ReasonCheckInOtherTagT> ||
                std::is_same_v<T, fbs::ReasonCheckInOtherMachineT> ||
                std::is_same_v<T, fbs::ReasonTimeoutT> ||
                std::is_same_v<T, fbs::ReasonSelfCheckoutT>>>
  tl::expected<MachineState, ErrorType> CheckOut(
      std::unique_ptr<T> checkout_reason);

  void QueueSessionDataUpload();
 private:
  std::string machine_id_;
  std::vector<std::string> required_permissions_;

  MachineState current_state_;
  fbs::MachineUsageHistoryT usage_history_;

  std::string usage_history_logfile_path;

  tl::expected<void, ErrorType> PersistHistory();
};

}  // namespace oww::state::session
