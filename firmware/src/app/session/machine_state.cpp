#include "machine_state.h"

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "app/application.h"
#include "app/cloud_request.h"
#include "app/configuration.h"
#include "fbs/machine_usage_generated.h"
#include "fbs/token_session_generated.h"
#include "token_session.h"

namespace oww::app::session {

Logger MachineUsage::logger("machine_usage");

MachineUsage::MachineUsage(oww::app::Application* app)
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
    Log.warn("Relais was ON at startup");
  }

  // TODO: Enable the external I2C bus bases on the configuration.
  pinMode(config::ext::pin_i2c_enable, OUTPUT);
  digitalWrite(config::ext::pin_i2c_enable, HIGH);
}

void MachineUsage::Loop() {
  state_machine_->Loop();
  UpdateRelaisState();
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
      Log.error("Failed to toggle actual relais state");
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

MachineStateMachine::StateOpt MachineUsage::OnIdle(
    machine_state::Idle& state) {
  // Nothing to do in idle
  return std::nullopt;
}

MachineStateMachine::StateOpt MachineUsage::OnActive(
    machine_state::Active& state) {
  // TODO: Implement session timeout logic
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
  logger.info("QueueSessionDataUpload");

  // This method would normally use CloudRequest, but since we don't have access
  // to the State instance here, we'll leave this as a stub for now. In a real
  // implementation, this would be called from the State class which has access
  // to the CloudRequest instance.

  logger.warn("Cloud upload not implemented - needs State instance access");
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

}  // namespace oww::app::session