
#include "logic/application.h"

#include "common/byte_array.h"
#include "fbs/ledger_terminal-config_generated.h"
#include "nfc/nfc_tags.h"

namespace oww::logic {

Logger Application::logger("app.logic.application");

Application::Application(std::unique_ptr<Configuration> configuration)
    : boot_phase_(oww::state::system::BootPhase::Bootstrap),
      configuration_(std::move(configuration)),
      cloud_request_(std::make_shared<CloudRequest>()),
      sessions_(std::make_shared<session::Sessions>()),
      session_coordinator_(cloud_request_, sessions_),
      machine_usage_(this)

{}

Status Application::Begin() {
  os_mutex_create(&mutex_);

  if (auto status = configuration_->Begin(); status != Status::kOk) {
    return status;
  }

  auto device_config = configuration_->GetDeviceConfig();

  if (device_config->machines()->empty()) {
    logger.error("No Machine configured");
    return Status::kError;
  }

  auto machine = (device_config->machines()->begin());

  sessions_->Begin();
  machine_usage_.Begin(**machine);
  cloud_request_->Begin();

  return Status::kOk;
}

void Application::Loop() {
  // Update cloud requests
  cloud_request_->Loop();

  // Read NFC state (thread-safe across NFC thread boundary)
  auto nfc_state = oww::nfc::NfcTags::instance().GetNfcStateHandle();

  // Session coordinator observes NFC
  auto session_state = session_coordinator_.Loop(nfc_state);

  // Machine observes session coordinator
  auto machine_state = machine_usage_.Loop(session_state);

  // All states available for UI/debugging
  (void)machine_state;  // Unused for now
}

// IApplicationState implementation
state::SystemStateHandle Application::GetSystemState() const {
  // Return Ready if boot is complete
  if (!boot_phase_.has_value()) {
    return std::make_shared<state::SystemState>(state::system::Ready{});
  } else {
    return std::make_shared<state::SystemState>(
        state::system::Booting{boot_phase_.value()});
  }
}

state::TagStateHandle Application::GetTagState() const {
  // TODO: Proper conversion from internal to public state types
  // For now, return NoTag as placeholder
  return std::make_shared<state::TagState>(state::tag::NoTag{});
}

state::MachineStateHandle Application::GetMachineState() const {
  // Return unified machine state directly (no conversion needed)
  return machine_usage_.GetState();
}

tl::expected<void, ErrorType> Application::RequestManualCheckOut() {
  return machine_usage_.ManualCheckOut();
}

void Application::RequestCancelCurrentOperation() {
  // TODO: Implement cancel operation
}

void Application::SetBootProgress(state::system::BootPhase phase) {
  boot_phase_ = phase;
  logger.info("Boot phase: %d", static_cast<uint8_t>(phase));
}
void Application::BootCompleted() { boot_phase_.reset(); }
bool Application::IsBootCompleted() { return !boot_phase_.has_value(); }

}  // namespace oww::logic
