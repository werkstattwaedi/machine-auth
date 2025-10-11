#pragma once

#include <array>
#include <chrono>
#include <memory>
#include <string>
#include <variant>

namespace oww::state::session {

// Session coordinator states (tag authentication flow)
struct Idle {};

struct WaitingForTag {};

struct AuthenticatingTag {
  std::array<uint8_t, 7> tag_uid;
};

struct SessionActive {
  std::array<uint8_t, 7> tag_uid;
  std::string session_id;
  std::string user_id;
  std::string user_label;
};

struct Rejected {
  std::string message;
  std::chrono::time_point<std::chrono::system_clock> time;
};

}  // namespace oww::state::session

namespace oww::state {

// Session state variant
using SessionState = std::variant<
    session::Idle,
    session::WaitingForTag,
    session::AuthenticatingTag,
    session::SessionActive,
    session::Rejected>;

using SessionStateHandle = std::shared_ptr<SessionState>;

}  // namespace oww::state
