#pragma once

#include <array>
#include <memory>
#include <string>

#include "state/iapplication_state.h"

namespace oww::logic {

/**
 * @brief Mock Application for simulator
 *
 * Implements IApplicationState interface for UI testing.
 * Use keyboard shortcuts to cycle through states.
 */
class MockApplication : public state::IApplicationState {
 public:
  MockApplication();

  // IApplicationState interface (state queries)
  state::SystemStateHandle GetSystemState() const override;
  state::TagStateHandle GetTagState() const override;
  state::MachineStateHandle GetMachineState() const override;

  // IApplicationState interface (actions)
  tl::expected<void, ErrorType> RequestManualCheckOut() override;
  void RequestCancelCurrentOperation() override;

  // Simulator-specific state control (for keyboard shortcuts)
  void SetBootProgress(state::system::BootPhase phase);
  void BootCompleted();
  void CycleBootPhase();  // Cycle through boot phases, then complete
  void CycleTagState();
  void CycleMachineState();
  void TriggerActiveSession();
  void TriggerDenied();
  void ReturnToIdle();

 private:
  state::SystemStateHandle system_state_;
  std::shared_ptr<state::TagStateMachine> tag_state_machine_;
  std::shared_ptr<state::MachineStateMachine> machine_state_machine_;

  // Test data
  std::array<uint8_t, 7> test_tag_uid_ = {0x04, 0xc3, 0x39, 0xaa, 0x1e, 0x18, 0x90};
  std::string test_user_ = "John Doe";
  std::string test_user_id_ = "test-user-123";
  std::string test_session_id_ = "test-session-123";
  std::shared_ptr<state::TokenSession> test_session_;
};

}  // namespace oww::logic
