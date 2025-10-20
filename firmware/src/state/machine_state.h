#pragma once

#include <chrono>
#include <memory>
#include <string>
#include <variant>

#include "state/state_machine.h"

namespace oww::state {
class TokenSession;

namespace machine {
struct Idle {};

struct Active {
  std::shared_ptr<TokenSession> session;
  std::chrono::time_point<std::chrono::system_clock> start_time;
};

struct Denied {
  std::string message;
  std::chrono::time_point<std::chrono::system_clock> time;
};

}  // namespace machine

using MachineStateMachine =
    StateMachine<machine::Idle, machine::Active, machine::Denied>;

using MachineState = MachineStateMachine::State;
using MachineStateHandle = MachineStateMachine::StateHandle;

}  // namespace oww::state
