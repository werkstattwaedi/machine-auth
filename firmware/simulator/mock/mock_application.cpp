#include "mock_application.h"
#include <cstdio>

namespace oww::logic {

MockApplication::MockApplication() {
  // Initialize to boot state
  system_state_ = std::make_shared<state::SystemState>(
      state::system::Booting{.message = "Starting..."});

  // Initialize to idle states
  session_state_ = std::make_shared<state::SessionState>(
      state::session::Idle{});

  machine_state_ = std::make_shared<state::MachineState>(
      state::machine::Idle{});
}

// IApplicationState interface implementation
state::SystemStateHandle MockApplication::GetSystemState() const {
  return system_state_;
}

state::SessionStateHandle MockApplication::GetSessionState() const {
  return session_state_;
}

state::MachineStateHandle MockApplication::GetMachineState() const {
  return machine_state_;
}

tl::expected<void, ErrorType> MockApplication::RequestManualCheckOut() {
  printf("[MockApp] Manual checkout requested\n");

  // Transition to idle states
  *session_state_ = state::session::Idle{};
  *machine_state_ = state::machine::Idle{};

  printf("[MockApp] Checked out - returned to idle\n");
  return {};
}

void MockApplication::RequestCancelCurrentOperation() {
  printf("[MockApp] Cancel operation requested\n");

  // Return to idle
  *session_state_ = state::session::Idle{};
  *machine_state_ = state::machine::Idle{};
}

// Simulator-specific methods
void MockApplication::SetBootProgress(std::string message) {
  *system_state_ = state::system::Booting{.message = message};
  printf("[MockApp] Boot progress: %s\n", message.c_str());
}

void MockApplication::BootCompleted() {
  *system_state_ = state::system::Ready{};
  printf("[MockApp] Boot completed - system ready\n");
}

void MockApplication::CycleSessionState() {
  if (std::holds_alternative<state::session::Idle>(*session_state_)) {
    *session_state_ = state::session::WaitingForTag{};
    printf("[MockApp] Session: Idle -> WaitingForTag\n");
  }
  else if (std::holds_alternative<state::session::WaitingForTag>(*session_state_)) {
    *session_state_ = state::session::AuthenticatingTag{
      .tag_uid = test_tag_uid_
    };
    printf("[MockApp] Session: WaitingForTag -> AuthenticatingTag\n");
  }
  else if (std::holds_alternative<state::session::AuthenticatingTag>(*session_state_)) {
    *session_state_ = state::session::SessionActive{
      .tag_uid = test_tag_uid_,
      .session_id = test_session_id_,
      .user_id = test_user_id_,
      .user_label = test_user_
    };
    printf("[MockApp] Session: AuthenticatingTag -> SessionActive (%s)\n", test_user_.c_str());
  }
  else if (std::holds_alternative<state::session::SessionActive>(*session_state_)) {
    *session_state_ = state::session::Rejected{
      .message = "Unknown tag",
      .time = std::chrono::system_clock::now()
    };
    printf("[MockApp] Session: SessionActive -> Rejected\n");
  }
  else if (std::holds_alternative<state::session::Rejected>(*session_state_)) {
    *session_state_ = state::session::Idle{};
    printf("[MockApp] Session: Rejected -> Idle\n");
  }
}

void MockApplication::CycleMachineState() {
  if (std::holds_alternative<state::machine::Idle>(*machine_state_)) {
    *machine_state_ = state::machine::Active{
      .session_id = test_session_id_,
      .user_id = test_user_id_,
      .user_label = test_user_,
      .start_time = std::chrono::system_clock::now()
    };
    printf("[MockApp] Machine: Idle -> Active (%s)\n", test_user_.c_str());
  }
  else if (std::holds_alternative<state::machine::Active>(*machine_state_)) {
    *machine_state_ = state::machine::Denied{
      .message = "Insufficient permissions",
      .time = std::chrono::system_clock::now()
    };
    printf("[MockApp] Machine: Active -> Denied\n");
  }
  else if (std::holds_alternative<state::machine::Denied>(*machine_state_)) {
    *machine_state_ = state::machine::Idle{};
    printf("[MockApp] Machine: Denied -> Idle\n");
  }
}

void MockApplication::TriggerActiveSession() {
  *session_state_ = state::session::SessionActive{
    .tag_uid = test_tag_uid_,
    .session_id = test_session_id_,
    .user_id = test_user_id_,
    .user_label = test_user_
  };

  *machine_state_ = state::machine::Active{
    .session_id = test_session_id_,
    .user_id = test_user_id_,
    .user_label = test_user_,
    .start_time = std::chrono::system_clock::now()
  };

  printf("[MockApp] Triggered active session for %s\n", test_user_.c_str());
}

void MockApplication::TriggerDenied() {
  *session_state_ = state::session::Rejected{
    .message = "Access denied",
    .time = std::chrono::system_clock::now()
  };

  *machine_state_ = state::machine::Denied{
    .message = "Insufficient permissions",
    .time = std::chrono::system_clock::now()
  };

  printf("[MockApp] Triggered denied state\n");
}

void MockApplication::ReturnToIdle() {
  *session_state_ = state::session::Idle{};
  *machine_state_ = state::machine::Idle{};
  printf("[MockApp] Returned to idle\n");
}

}  // namespace oww::logic
