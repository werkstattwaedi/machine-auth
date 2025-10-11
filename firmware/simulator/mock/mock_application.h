#pragma once

#include <array>
#include <chrono>
#include <memory>
#include <string>
#include <variant>

namespace oww::logic {
namespace session {

// Forward declarations for state types
namespace coordinator_state {
struct Idle {};
struct WaitingForTag {};
struct AuthenticatingTag {
  std::array<uint8_t, 7> tag_uid;
};
struct SessionActive {
  std::array<uint8_t, 7> tag_uid;
  std::string user_label;
  std::string session_id;
};
struct Rejected {
  std::string message;
  std::chrono::time_point<std::chrono::system_clock> time;
};
}  // namespace coordinator_state

namespace machine_state {
struct Idle {};
struct Active {
  std::string user_label;
  std::string session_id;
  std::chrono::time_point<std::chrono::system_clock> start_time;
};
struct Denied {
  std::string message;
  std::chrono::time_point<std::chrono::system_clock> time;
};
}  // namespace machine_state

// State handle types (simplified for simulator)
using SessionState = std::variant<
    coordinator_state::Idle,
    coordinator_state::WaitingForTag,
    coordinator_state::AuthenticatingTag,
    coordinator_state::SessionActive,
    coordinator_state::Rejected>;

using MachineState = std::variant<
    machine_state::Idle,
    machine_state::Active,
    machine_state::Denied>;

// Simplified state handles (shared_ptr to variant)
using SessionStateHandle = std::shared_ptr<SessionState>;
using StateHandle = std::shared_ptr<MachineState>;

}  // namespace session

/**
 * @brief Mock Application for simulator
 *
 * Provides a simplified Application interface for UI testing.
 * Use keyboard shortcuts to cycle through states.
 */
class MockApplication {
 public:
  MockApplication();

  // Boot progress
  void SetBootProgress(std::string message);
  void BootCompleted();
  bool IsBootCompleted();
  std::string GetBootProgress();

  // State queries (thread-safe in real app, simplified for simulator)
  session::SessionStateHandle GetSessionState();
  session::StateHandle GetMachineState();

  // State control (for keyboard shortcuts)
  void CycleSessionState();
  void CycleMachineState();
  void TriggerActiveSession();
  void TriggerDenied();
  void ReturnToIdle();

 private:
  bool boot_completed_ = false;
  std::string boot_progress_;

  session::SessionStateHandle session_state_;
  session::StateHandle machine_state_;

  // Test data
  std::array<uint8_t, 7> test_tag_uid_ = {0x04, 0xc3, 0x39, 0xaa, 0x1e, 0x18, 0x90};
  std::string test_user_ = "John Doe";
  std::string test_session_id_ = "test-session-123";
};

}  // namespace oww::logic
