#pragma once

#include <chrono>
#include <memory>
#include <string>
#include <variant>

namespace oww::state::system {

// Boot phases during system initialization
enum class BootPhase : uint8_t {
  Bootstrap,
  WaitForDebugger,
  InitHardware,
  ConnectWifi,
  ConnectCloud,
  WaitForConfig,
};

// System-level states (boot, connectivity, errors)
struct Booting {
  BootPhase phase;
};

struct Ready {};

struct NoWifi {
  std::string reason;
  std::chrono::time_point<std::chrono::system_clock> time;
};

struct NoCloud {
  std::string reason;
  std::chrono::time_point<std::chrono::system_clock> time;
};

struct Error {
  std::string message;
  std::chrono::time_point<std::chrono::system_clock> time;
};

}  // namespace oww::state::system

namespace oww::state {

// System state variant
using SystemState = std::variant<
    system::Booting,
    system::Ready,
    system::NoWifi,
    system::NoCloud,
    system::Error>;

using SystemStateHandle = std::shared_ptr<SystemState>;

}  // namespace oww::state
