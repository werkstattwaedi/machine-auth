#include "mock_application.h"
#include <cstdio>
#include "state/token_session.h"
#include "fbs/token_session_generated.h"

namespace oww::logic {

MockApplication::MockApplication() {
  // Initialize to boot state
  system_state_ = std::make_shared<state::SystemState>(
      state::system::Booting{.phase = state::system::BootPhase::InitHardware});

  // Initialize to idle states - no tag present
  tag_state_ = std::make_shared<state::TagState>(
      state::tag::NoTag{});

  machine_state_machine_ = state::MachineStateMachine::Create(
      std::in_place_type<state::machine::Idle>);

  // Create a test session for simulator using flatbuffer
  fbs::TokenSessionT test_session_fbs;
  // TagUid is a struct - create using span constructor
  test_session_fbs.token_id = std::make_unique<fbs::TagUid>(
      flatbuffers::span<const uint8_t, 7>(test_tag_uid_.data(), test_tag_uid_.size()));
  test_session_fbs.session_id = test_session_id_;
  test_session_fbs.expiration = std::chrono::duration_cast<std::chrono::seconds>(
      (std::chrono::system_clock::now() + std::chrono::hours(24)).time_since_epoch()).count();
  test_session_fbs.user_id = test_user_id_;
  test_session_fbs.user_label = test_user_;
  test_session_fbs.permissions = {"machine_access", "admin"};

  test_session_ = std::make_shared<state::TokenSession>(test_session_fbs);
}

// IApplicationState interface implementation
state::SystemStateHandle MockApplication::GetSystemState() const {
  return system_state_;
}

state::TagStateHandle MockApplication::GetTagState() const {
  return tag_state_;
}

state::MachineStateHandle MockApplication::GetMachineState() const {
  return machine_state_machine_->GetStateHandle();
}

tl::expected<void, ErrorType> MockApplication::RequestManualCheckOut() {
  printf("[MockApp] Manual checkout requested\n");

  // Transition to idle states - no tag
  *tag_state_ = state::tag::NoTag{};
  machine_state_machine_->TransitionTo(state::machine::Idle{});

  printf("[MockApp] Checked out - returned to idle\n");
  return {};
}

void MockApplication::RequestCancelCurrentOperation() {
  printf("[MockApp] Cancel operation requested\n");

  // Return to idle - no tag
  *tag_state_ = state::tag::NoTag{};
  machine_state_machine_->TransitionTo(state::machine::Idle{});
}

// Simulator-specific methods
void MockApplication::SetBootProgress(state::system::BootPhase phase) {
  *system_state_ = state::system::Booting{.phase = phase};
  printf("[MockApp] Boot phase: %d\n", static_cast<uint8_t>(phase));
}

void MockApplication::BootCompleted() {
  *system_state_ = state::system::Ready{};
  printf("[MockApp] Boot completed - system ready\n");
}

void MockApplication::CycleBootPhase() {
  if (std::holds_alternative<state::system::Ready>(*system_state_)) {
    // Already booted, restart to first phase
    *system_state_ = state::system::Booting{.phase = state::system::BootPhase::Bootstrap};
    printf("[MockApp] Boot: Ready -> Bootstrap\n");
  } else if (std::holds_alternative<state::system::Booting>(*system_state_)) {
    auto& booting = std::get<state::system::Booting>(*system_state_);
    switch (booting.phase) {
      case state::system::BootPhase::Bootstrap:
        booting.phase = state::system::BootPhase::WaitForDebugger;
        printf("[MockApp] Boot: Bootstrap -> WaitForDebugger\n");
        break;
      case state::system::BootPhase::WaitForDebugger:
        booting.phase = state::system::BootPhase::InitHardware;
        printf("[MockApp] Boot: WaitForDebugger -> InitHardware\n");
        break;
      case state::system::BootPhase::InitHardware:
        booting.phase = state::system::BootPhase::ConnectWifi;
        printf("[MockApp] Boot: InitHardware -> ConnectWifi\n");
        break;
      case state::system::BootPhase::ConnectWifi:
        booting.phase = state::system::BootPhase::ConnectCloud;
        printf("[MockApp] Boot: ConnectWifi -> ConnectCloud\n");
        break;
      case state::system::BootPhase::ConnectCloud:
        booting.phase = state::system::BootPhase::WaitForConfig;
        printf("[MockApp] Boot: ConnectCloud -> WaitForConfig\n");
        break;
      case state::system::BootPhase::WaitForConfig:
        BootCompleted();
        break;
    }
  }
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
  auto state = machine_state_machine_->GetStateHandle();
  if (state.Is<state::machine::Idle>()) {
    machine_state_machine_->TransitionTo(state::machine::Active{
      .session = test_session_,
      .start_time = std::chrono::system_clock::now()
    });
    printf("[MockApp] Machine: Idle -> Active (%s)\n", test_user_.c_str());
  }
  else if (state.Is<state::machine::Active>()) {
    machine_state_machine_->TransitionTo(state::machine::Denied{
      .message = "Insufficient permissions",
      .time = std::chrono::system_clock::now()
    });
    printf("[MockApp] Machine: Active -> Denied\n");
  }
  else if (state.Is<state::machine::Denied>()) {
    machine_state_machine_->TransitionTo(state::machine::Idle{});
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

  machine_state_machine_->TransitionTo(state::machine::Active{
    .session = test_session_,
    .start_time = std::chrono::system_clock::now()
  });

  printf("[MockApp] Triggered active session for %s\n", test_user_.c_str());
}

void MockApplication::TriggerDenied() {
  *tag_state_ = state::tag::UnsupportedTag{
    .tag_uid = test_tag_uid_,
    .reason = "Access denied"
  };

  machine_state_machine_->TransitionTo(state::machine::Denied{
    .message = "Insufficient permissions",
    .time = std::chrono::system_clock::now()
  });

  printf("[MockApp] Triggered denied state\n");
}

void MockApplication::ReturnToIdle() {
  *tag_state_ = state::tag::NoTag{};
  machine_state_machine_->TransitionTo(state::machine::Idle{});
  printf("[MockApp] Returned to idle\n");
}

}  // namespace oww::logic
