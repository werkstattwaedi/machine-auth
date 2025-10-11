#pragma once

#include <chrono>
#include <memory>
#include <string>
#include <variant>

namespace oww::state::machine {

// Machine usage states (machine on/off, access control)
struct Idle {};

struct Active {
  std::string session_id;
  std::string user_id;
  std::string user_label;
  std::chrono::time_point<std::chrono::system_clock> start_time;
};

struct Denied {
  std::string message;
  std::chrono::time_point<std::chrono::system_clock> time;
};

}  // namespace oww::state::machine

namespace oww::state {

// Machine state variant
using MachineState = std::variant<
    machine::Idle,
    machine::Active,
    machine::Denied>;

using MachineStateHandle = std::shared_ptr<MachineState>;

}  // namespace oww::state
