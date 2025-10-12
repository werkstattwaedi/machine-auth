#include "mock_application.h"
#include <cstdio>

namespace oww::logic {

MockApplication::MockApplication() {
  // Initialize to boot state
  system_state_ = std::make_shared<state::SystemState>(
      state::system::Booting{.message = "Starting..."});

  // Initialize to idle states - no tag present
  tag_state_ = std::make_shared<state::TagState>(
      state::tag::NoTag{});

  machine_state_ = std::make_shared<state::MachineState>(
      state::machine::Idle{});
}

// IApplicationState interface implementation
state::SystemStateHandle MockApplication::GetSystemState() const {
  return system_state_;
}

state::TagStateHandle MockApplication::GetTagState() const {
  return tag_state_;
}

state::MachineStateHandle MockApplication::GetMachineState() const {
  return machine_state_;
}

tl::expected<void, ErrorType> MockApplication::RequestManualCheckOut() {
  printf("[MockApp] Manual checkout requested\n");

  // Transition to idle states - no tag
  *tag_state_ = state::tag::NoTag{};
  *machine_state_ = state::machine::Idle{};

  printf("[MockApp] Checked out - returned to idle\n");
  return {};
}

void MockApplication::RequestCancelCurrentOperation() {
  printf("[MockApp] Cancel operation requested\n");

  // Return to idle - no tag
  *tag_state_ = state::tag::NoTag{};
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

void MockApplication::CycleTagState() {
  if (std::holds_alternative<state::tag::NoTag>(*tag_state_)) {
    *tag_state_ = state::tag::AuthenticatedTag{
      .tag_uid = test_tag_uid_
    };
    printf("[MockApp] Tag: NoTag -> AuthenticatedTag\n");
  }
  else if (std::holds_alternative<state::tag::AuthenticatedTag>(*tag_state_)) {
    // Create a dummy session creation state machine (Begin state)
    auto session_creation_sm = state::session_creation::SessionCreationStateMachine::Create(
        std::in_place_type<state::session_creation::Begin>);
    *tag_state_ = state::tag::SessionTag{
      .tag_uid = test_tag_uid_,
      .creation_state = session_creation_sm->GetStateHandle()
    };
    printf("[MockApp] Tag: AuthenticatedTag -> SessionTag\n");
  }
  else if (std::holds_alternative<state::tag::SessionTag>(*tag_state_)) {
    *tag_state_ = state::tag::UnsupportedTag{
      .tag_uid = test_tag_uid_,
      .reason = "Unknown tag"
    };
    printf("[MockApp] Tag: SessionTag -> UnsupportedTag\n");
  }
  else if (std::holds_alternative<state::tag::UnsupportedTag>(*tag_state_)) {
    *tag_state_ = state::tag::NoTag{};
    printf("[MockApp] Tag: UnsupportedTag -> NoTag\n");
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
  // Create a dummy session creation state machine (Begin state)
  auto session_creation_sm = state::session_creation::SessionCreationStateMachine::Create(
      std::in_place_type<state::session_creation::Begin>);
  *tag_state_ = state::tag::SessionTag{
    .tag_uid = test_tag_uid_,
    .creation_state = session_creation_sm->GetStateHandle()
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
  *tag_state_ = state::tag::UnsupportedTag{
    .tag_uid = test_tag_uid_,
    .reason = "Access denied"
  };

  *machine_state_ = state::machine::Denied{
    .message = "Insufficient permissions",
    .time = std::chrono::system_clock::now()
  };

  printf("[MockApp] Triggered denied state\n");
}

void MockApplication::ReturnToIdle() {
  *tag_state_ = state::tag::NoTag{};
  *machine_state_ = state::machine::Idle{};
  printf("[MockApp] Returned to idle\n");
}

}  // namespace oww::logic
