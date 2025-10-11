#include "machine_state.h"

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "fbs/machine_usage_generated.h"
#include "fbs/token_session_generated.h"
#include "logic/application.h"
#include "logic/cloud_request.h"
#include "logic/configuration.h"
#include "session_coordinator.h"
#include "token_session.h"

namespace oww::logic::session {

Logger MachineUsage::logger("app.logic.session.machine_usage");

MachineUsage::MachineUsage(oww::logic::Application* app)
    : app_(app),
      state_machine_(MachineStateMachine::Create(
          std::in_place_type<machine_state::Idle>)) {
  RegisterStateHandlers();
}

void MachineUsage::RegisterStateHandlers() {
  state_machine_->OnLoop<machine_state::Idle>(
      [this](auto& state) { return OnIdle(state); });
  state_machine_->OnLoop<machine_state::Active>(
      [this](auto& state) { return OnActive(state); });
  state_machine_->OnLoop<machine_state::Denied>(
      [this](auto& state) { return OnDenied(state); });
}

void MachineUsage::Begin(const fbs::Machine& machine) {
  machine_id_ = machine.id()->str();
  usage_history_logfile_path =
      "/machine_" + machine.id()->str() + "/machine_history.data";
  if (machine.required_permissions()) {
    for (const auto* permission : *machine.required_permissions()) {
      required_permissions_.push_back(permission->str());
    }
  }

  // Restore persisted usage history.
  std::ifstream file(usage_history_logfile_path,
                     std::ios::binary | std::ios::ate);
  if (file) {
    std::streamsize size = file.tellg();
    file.seekg(0, std::ios::beg);
    std::vector<char> buffer(size);
    if (file.read(buffer.data(), size)) {
      const fbs::MachineUsageHistory* restored_history =
          flatbuffers::GetRoot<fbs::MachineUsageHistory>(buffer.data());

      if (machine_id_ == restored_history->machine_id()->str()) {
        restored_history->UnPackTo(&usage_history_);
      } else {
        logger.error(
            "MachineID mismatch in history file. restored: %s expected: %s",
            restored_history->machine_id()->c_str(), machine_id_.c_str());
      }
    } else {
      logger.error("Unable to restore history file %s",
                   usage_history_logfile_path.c_str());
    }
  }

  pinMode(config::ext::pin_relais, INPUT);
  relais_state_ = digitalRead(config::ext::pin_relais) ? HIGH : LOW;
  if (relais_state_ == HIGH) {
    logger.warn("Relais was ON at startup");
  }

  // TODO: Enable the external I2C bus bases on the configuration.
  pinMode(config::ext::pin_i2c_enable, OUTPUT);
  digitalWrite(config::ext::pin_i2c_enable, HIGH);
}

StateHandle MachineUsage::Loop(const SessionStateHandle& session_state) {
  // Observe session coordinator state transitions
  if (last_session_state_) {
    // Need to get the state machine from SessionCoordinator
    // For now, check state types directly on handles

    // Session became active
    bool was_idle = last_session_state_->Is<coordinator_state::Idle>() ||
                    last_session_state_->Is<coordinator_state::WaitingForTag>() ||
                    last_session_state_->Is<coordinator_state::AuthenticatingTag>();
    bool is_active = session_state.Is<coordinator_state::SessionActive>();

    if (was_idle && is_active) {
      // Session became active, check in
      auto* active = session_state.Get<coordinator_state::SessionActive>();
      if (active) {
        logger.info("Session active, checking in user: %s",
                    active->session->GetUserLabel().c_str());
        auto result = CheckIn(active->session);
        if (!result) {
          logger.error("CheckIn failed: %d", (int)result.error());
        }
      }
    }

    // Session ended
    bool was_active = last_session_state_->Is<coordinator_state::SessionActive>();
    bool is_idle = session_state.Is<coordinator_state::Idle>();

    if (was_active && is_idle) {
      // Session ended, check out if machine is still active
      if (state_machine_->Is<machine_state::Active>()) {
        logger.info("Session ended, checking out");
        auto result = CheckOut(std::make_unique<fbs::ReasonUiT>());
        if (!result) {
          logger.error("CheckOut failed: %d", (int)result.error());
        }
      }
    }
  }

  last_session_state_ = session_state;

  // Run state machine
  auto handle = state_machine_->Loop();
  UpdateRelaisState();

  return handle;
}

tl::expected<void, ErrorType> MachineUsage::ManualCheckOut() {
  return CheckOut(std::make_unique<fbs::ReasonUiT>());
}

void MachineUsage::UpdateRelaisState() {
  PinState expected_relais_state =
      state_machine_->Is<machine_state::Active>() ? HIGH : LOW;

  if (relais_state_ != expected_relais_state) {
    relais_state_ = expected_relais_state;
    logger.info("Toggle Relais %s", relais_state_ == HIGH ? "HIGH" : "LOW");

    digitalWrite(config::ext::pin_relais, relais_state_);
    pinMode(config::ext::pin_relais, OUTPUT);
    digitalWrite(config::ext::pin_relais, relais_state_);
    delay(50);
    pinMode(config::ext::pin_relais, INPUT);

    auto actual_state = digitalRead(config::ext::pin_relais) ? HIGH : LOW;
    if (actual_state != relais_state_) {
      logger.error("Failed to toggle actual relais state");
    }
  }
}

tl::expected<void, ErrorType> MachineUsage::CheckIn(
    std::shared_ptr<TokenSession> session) {
  if (!state_machine_->Is<machine_state::Idle>()) {
    logger.warn("CheckIn failed: machine not idle");
    return tl::unexpected(ErrorType::kWrongState);
  }

  auto now = timeUtc();

  // Check if session has all required permissions
  for (const auto& permission : required_permissions_) {
    if (!session->HasPermission(permission)) {
      // Build diagnostic message with actual vs required permissions
      std::string required_perms;
      for (const auto& perm : required_permissions_) {
        if (!required_perms.empty()) required_perms += ", ";
        required_perms += "'" + perm + "'";
      }

      std::string user_perms;
      for (const auto& perm : session->GetPermissions()) {
        if (!user_perms.empty()) user_perms += ", ";
        user_perms += "'" + perm + "'";
      }
      if (user_perms.empty()) user_perms = "(none)";

      logger.warn("Permission denied: missing '%s'. Required: [%s], User has: [%s]",
                  permission.c_str(), required_perms.c_str(), user_perms.c_str());
      state_machine_->TransitionTo(
          machine_state::Denied{.message = "Keine Berechtigung", .time = now});
      return {};
    }
  }

  state_machine_->TransitionTo(machine_state::Active{
      .session = session,
      .start_time = now,
  });

  auto record = std::make_unique<fbs::MachineUsageT>();
  record->session_id = session->GetSessionId();
  record->check_in =
      std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch())
          .count();

  usage_history_.records.push_back(std::move(record));

  // Persist immediately for crash safety
  auto persist_result = PersistHistory();
  if (!persist_result) {
    logger.error("Failed to persist check-in record");
    // Continue anyway - machine is already active
  }

  return {};
}

template <typename T>
tl::expected<void, ErrorType> MachineUsage::CheckOut(
    std::unique_ptr<T> checkout_reason) {
  if (!state_machine_->Is<machine_state::Active>()) {
    logger.warn("CheckOut failed: machine not in use");
    return tl::unexpected(ErrorType::kWrongState);
  }
  auto active_state = state_machine_->Get<machine_state::Active>();

  if (usage_history_.records.empty()) {
    logger.error("No history record");
    return tl::unexpected(ErrorType::kUnexpectedState);
  }

  auto last_record = usage_history_.records.back().get();

  if (last_record->session_id != active_state->session->GetSessionId() ||
      last_record->check_out > 0L) {
    logger.error("Unexpected last record in history");
    return tl::unexpected(ErrorType::kUnexpectedState);
  }

  auto now = timeUtc();

  last_record->check_out =
      std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch())
          .count();
  last_record->reason.Set(std::move(checkout_reason));

  state_machine_->TransitionTo(machine_state::Idle{});

  UploadHistory();

  return {};
}

MachineStateMachine::StateOpt MachineUsage::OnIdle(machine_state::Idle& state) {
  // Nothing to do in idle
  return std::nullopt;
}

MachineStateMachine::StateOpt MachineUsage::OnActive(
    machine_state::Active& state) {
  // Check for session timeout (e.g., 8 hours absolute timeout)
  constexpr auto ABSOLUTE_TIMEOUT = std::chrono::hours(8);

  auto now = timeUtc();
  auto elapsed = now - state.start_time;

  if (elapsed > ABSOLUTE_TIMEOUT) {
    logger.warn("Session timeout after %d minutes",
                (int)std::chrono::duration_cast<std::chrono::minutes>(elapsed)
                    .count());

    // Complete the usage record with timeout reason
    if (!usage_history_.records.empty()) {
      auto last_record = usage_history_.records.back().get();
      if (last_record->check_out == 0L) {
        last_record->check_out =
            std::chrono::duration_cast<std::chrono::seconds>(
                now.time_since_epoch())
                .count();
        last_record->reason.Set(std::make_unique<fbs::ReasonTimeoutT>());

        // Persist and upload
        PersistHistory();
        UploadHistory();
      }
    }

    return machine_state::Idle{};
  }

  // Could also check for idle timeout based on last activity
  // For now, just check absolute timeout
  return std::nullopt;
}

MachineStateMachine::StateOpt MachineUsage::OnDenied(
    machine_state::Denied& state) {
  // After a delay, transition back to idle
  if (timeUtc() - state.time > std::chrono::seconds(5)) {
    return machine_state::Idle{};
  }
  return std::nullopt;
}

// Explicit instantiation for each type used.
template tl::expected<void, ErrorType> MachineUsage::CheckOut<fbs::ReasonUiT>(
    std::unique_ptr<fbs::ReasonUiT> checkout_reason);
template tl::expected<void, ErrorType>
MachineUsage::CheckOut<fbs::ReasonCheckInOtherTagT>(
    std::unique_ptr<fbs::ReasonCheckInOtherTagT> checkout_reason);
template tl::expected<void, ErrorType>
MachineUsage::CheckOut<fbs::ReasonCheckInOtherMachineT>(
    std::unique_ptr<fbs::ReasonCheckInOtherMachineT> checkout_reason);
template tl::expected<void, ErrorType> MachineUsage::CheckOut<
    fbs::ReasonTimeoutT>(std::unique_ptr<fbs::ReasonTimeoutT> checkout_reason);
template tl::expected<void, ErrorType>
MachineUsage::CheckOut<fbs::ReasonSelfCheckoutT>(
    std::unique_ptr<fbs::ReasonSelfCheckoutT> checkout_reason);

void MachineUsage::UploadHistory() {
  logger.info("Uploading usage history");

  if (usage_history_.records.empty()) {
    logger.trace("No records to upload");
    return;
  }

  // Get CloudRequest from Application
  auto cloud_request = app_->GetCloudRequest();
  if (!cloud_request) {
    logger.error("CloudRequest not available");
    return;
  }

  // Build upload request
  fbs::UploadUsageRequestT request;
  request.history = std::make_unique<fbs::MachineUsageHistoryT>();
  request.history->machine_id = usage_history_.machine_id;

  // Copy records to request
  for (const auto& record : usage_history_.records) {
    request.history->records.push_back(
        std::make_unique<fbs::MachineUsageT>(*record));
  }

  logger.info("Uploading %d usage record(s)",
              (int)request.history->records.size());

  // Send async request
  auto response = cloud_request->SendTerminalRequest<fbs::UploadUsageRequestT,
                                                      fbs::UploadUsageResponseT>(
      "uploadUsage", request);

  // TODO: Track response and clear uploaded records on success
  // For now, we'll optimistically clear after upload attempt
  // In a production system, we'd wait for confirmation

  // Clear uploaded records after successful upload
  // (In the future, we should wait for response and only clear on success)
  usage_history_.records.clear();

  // Persist the cleared history
  auto persist_result = PersistHistory();
  if (!persist_result) {
    logger.error("Failed to persist history after upload");
  }
}

tl::expected<void, ErrorType> MachineUsage::PersistHistory() {
  flatbuffers::FlatBufferBuilder builder(1024);
  builder.Finish(fbs::MachineUsageHistory::Pack(builder, &usage_history_));

  std::ofstream file(usage_history_logfile_path, std::ios::binary);
  if (!file) {
    logger.error("Failed to open history file for writing: %s",
                 usage_history_logfile_path.c_str());
    return tl::unexpected(ErrorType::kUnspecified);
  }

  file.write(reinterpret_cast<const char*>(builder.GetBufferPointer()),
             builder.GetSize());
  if (!file) {
    logger.error("Failed to write to history file: %s",
                 usage_history_logfile_path.c_str());
    return tl::unexpected(ErrorType::kUnspecified);
  }

  return {};
}

}  // namespace oww::logic::session