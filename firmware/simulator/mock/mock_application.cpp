#include "mock_application.h"
#include <cstdio>

namespace oww::logic {

MockApplication::MockApplication() {
  // Initialize to idle states
  session_state_ = std::make_shared<session::SessionState>(
      session::coordinator_state::Idle{});
  machine_state_ = std::make_shared<session::MachineState>(
      session::machine_state::Idle{});
}

void MockApplication::SetBootProgress(std::string message) {
  boot_progress_ = message;
  printf("[MockApp] Boot progress: %s\n", message.c_str());
}

void MockApplication::BootCompleted() {
  boot_completed_ = true;
  printf("[MockApp] Boot completed\n");
}

bool MockApplication::IsBootCompleted() {
  return boot_completed_;
}

std::string MockApplication::GetBootProgress() {
  return boot_progress_;
}

session::SessionStateHandle MockApplication::GetSessionState() {
  return session_state_;
}

session::StateHandle MockApplication::GetMachineState() {
  return machine_state_;
}

void MockApplication::CycleSessionState() {
  // Cycle through session states
  if (std::holds_alternative<session::coordinator_state::Idle>(*session_state_)) {
    *session_state_ = session::coordinator_state::WaitingForTag{};
    printf("[MockApp] Session state: Idle -> WaitingForTag\n");
  }
  else if (std::holds_alternative<session::coordinator_state::WaitingForTag>(*session_state_)) {
    *session_state_ = session::coordinator_state::AuthenticatingTag{
      .tag_uid = test_tag_uid_
    };
    printf("[MockApp] Session state: WaitingForTag -> AuthenticatingTag\n");
  }
  else if (std::holds_alternative<session::coordinator_state::AuthenticatingTag>(*session_state_)) {
    *session_state_ = session::coordinator_state::SessionActive{
      .tag_uid = test_tag_uid_,
      .user_label = test_user_,
      .session_id = test_session_id_
    };
    printf("[MockApp] Session state: AuthenticatingTag -> SessionActive (%s)\n", test_user_.c_str());
  }
  else if (std::holds_alternative<session::coordinator_state::SessionActive>(*session_state_)) {
    *session_state_ = session::coordinator_state::Rejected{
      .message = "Unknown tag",
      .time = std::chrono::system_clock::now()
    };
    printf("[MockApp] Session state: SessionActive -> Rejected\n");
  }
  else if (std::holds_alternative<session::coordinator_state::Rejected>(*session_state_)) {
    *session_state_ = session::coordinator_state::Idle{};
    printf("[MockApp] Session state: Rejected -> Idle\n");
  }
}

void MockApplication::CycleMachineState() {
  // Cycle through machine states
  if (std::holds_alternative<session::machine_state::Idle>(*machine_state_)) {
    *machine_state_ = session::machine_state::Active{
      .user_label = test_user_,
      .session_id = test_session_id_,
      .start_time = std::chrono::system_clock::now()
    };
    printf("[MockApp] Machine state: Idle -> Active (%s)\n", test_user_.c_str());
  }
  else if (std::holds_alternative<session::machine_state::Active>(*machine_state_)) {
    *machine_state_ = session::machine_state::Denied{
      .message = "Insufficient permissions",
      .time = std::chrono::system_clock::now()
    };
    printf("[MockApp] Machine state: Active -> Denied\n");
  }
  else if (std::holds_alternative<session::machine_state::Denied>(*machine_state_)) {
    *machine_state_ = session::machine_state::Idle{};
    printf("[MockApp] Machine state: Denied -> Idle\n");
  }
}

void MockApplication::TriggerActiveSession() {
  *session_state_ = session::coordinator_state::SessionActive{
    .tag_uid = test_tag_uid_,
    .user_label = test_user_,
    .session_id = test_session_id_
  };

  *machine_state_ = session::machine_state::Active{
    .user_label = test_user_,
    .session_id = test_session_id_,
    .start_time = std::chrono::system_clock::now()
  };

  printf("[MockApp] Triggered active session for %s\n", test_user_.c_str());
}

void MockApplication::TriggerDenied() {
  *session_state_ = session::coordinator_state::Rejected{
    .message = "Access denied",
    .time = std::chrono::system_clock::now()
  };

  *machine_state_ = session::machine_state::Denied{
    .message = "Insufficient permissions",
    .time = std::chrono::system_clock::now()
  };

  printf("[MockApp] Triggered denied state\n");
}

void MockApplication::ReturnToIdle() {
  *session_state_ = session::coordinator_state::Idle{};
  *machine_state_ = session::machine_state::Idle{};
  printf("[MockApp] Returned to idle\n");
}

}  // namespace oww::logic
