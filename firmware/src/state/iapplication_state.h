#pragma once

#include "common/expected.h"
#include "common/status.h"
#include "machine_state.h"
#include "session_state.h"
#include "system_state.h"

namespace oww::state {

/**
 * @brief Interface for application state queries and actions
 *
 * This interface abstracts the application state for the UI layer.
 * - UI queries state to render screens
 * - UI calls action methods to request state changes
 * - Implementations: logic::Application (firmware), MockApplication (simulator)
 */
class IApplicationState {
 public:
  virtual ~IApplicationState() = default;

  // State queries (read-only)
  virtual SystemStateHandle GetSystemState() const = 0;
  virtual SessionStateHandle GetSessionState() const = 0;
  virtual MachineStateHandle GetMachineState() const = 0;

  // Actions (UI-initiated state changes)
  // These methods request changes; application decides if/when to apply them
  virtual tl::expected<void, ErrorType> RequestManualCheckOut() = 0;
  virtual void RequestCancelCurrentOperation() = 0;
};

}  // namespace oww::state
