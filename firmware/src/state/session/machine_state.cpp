#include "machine_state.h"

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "../cloud_request.h"
#include "../configuration.h"
#include "../state.h"
#include "fbs/machine_usage_generated.h"
#include "fbs/token_session_generated.h"
#include "token_session.h"

namespace oww::state::session {

Logger MachineUsage::logger("machine_usage");

void MachineUsage::Begin(const fbs::Machine& machine) {
  machine_id_ = machine.id()->str();

  std::stringstream path;
  path << "/machine_" << machine_id_ << "/machine_history.data";
  usage_history_logfile_path = path.str();

  // 1. Read the binary file into a vector<char>
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

  // TODO restore session upon reboot
  current_state_ = machine_state::Idle{};
}

void MachineUsage::Loop() {
  // This method is called regularly and can be used for periodic tasks
  // Currently no periodic tasks needed for machine usage
}

tl::expected<MachineState, ErrorType> MachineUsage::CheckIn(
    std::shared_ptr<TokenSession> session) {
  if (std::holds_alternative<machine_state::Active>(current_state_)) {
    logger.warn("CheckIn failed: machine already in use");
    return tl::unexpected(ErrorType::kWrongState);
  }

  auto now = timeUtc();

  current_state_ = machine_state::Active{
      .session = session,
      .start_time = now,
  };

  auto record = std::make_unique<fbs::MachineUsageT>();
  record->session_id = session->GetSessionId();
  record->check_in =
      std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch())
          .count();

  usage_history_.records.push_back(std::move(record));

  return current_state_;
}

template <typename T, typename>
tl::expected<MachineState, ErrorType> MachineUsage::CheckOut(
    std::unique_ptr<T> checkout_reason) {
  auto active_state = std::get_if<machine_state::Active>(&current_state_);

  if (!active_state) {
    logger.warn("CheckOut failed: machine not in use");
    return tl::unexpected(ErrorType::kWrongState);
  }

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

  // Transition to idle state
  current_state_ = machine_state::Idle{};

  QueueSessionDataUpload();

  return current_state_;
}

// Explicit instantiation for each type used.
template tl::expected<MachineState, ErrorType> MachineUsage::CheckOut<
    fbs::ReasonUiT>(std::unique_ptr<fbs::ReasonUiT> checkout_reason);
template tl::expected<MachineState, ErrorType>
MachineUsage::CheckOut<fbs::ReasonCheckInOtherTagT>(
    std::unique_ptr<fbs::ReasonCheckInOtherTagT> checkout_reason);
template tl::expected<MachineState, ErrorType>
MachineUsage::CheckOut<fbs::ReasonCheckInOtherMachineT>(
    std::unique_ptr<fbs::ReasonCheckInOtherMachineT> checkout_reason);
template tl::expected<MachineState, ErrorType> MachineUsage::CheckOut<
    fbs::ReasonTimeoutT>(std::unique_ptr<fbs::ReasonTimeoutT> checkout_reason);
template tl::expected<MachineState, ErrorType>
MachineUsage::CheckOut<fbs::ReasonSelfCheckoutT>(
    std::unique_ptr<fbs::ReasonSelfCheckoutT> checkout_reason);

void MachineUsage::QueueSessionDataUpload() {
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

  uint8_t* buffer = builder.GetBufferPointer();
  size_t size = builder.GetSize();

  std::ofstream outfile(usage_history_logfile_path, std::ios::binary);
  if (!outfile.is_open()) {
    return tl::unexpected(ErrorType::kUnspecified);
  }
  outfile.write(reinterpret_cast<const char*>(buffer), size);
  outfile.close();

  return {};
}

}  // namespace oww::state::session
