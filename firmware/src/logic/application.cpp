
#include "logic/application.h"

#include "common/byte_array.h"
#include "fbs/ledger_terminal-config_generated.h"
#include "nfc/nfc_tags.h"

namespace oww::logic {

Logger Application::logger("app.logic.application");

Application::Application(std::unique_ptr<Configuration> configuration)
    : boot_progress_("Starte..."),
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
  // TODO: Implement proper system state tracking
  // For now, return Ready if boot is complete
  if (boot_progress_.empty()) {
    return std::make_shared<state::SystemState>(state::system::Ready{});
  } else {
    return std::make_shared<state::SystemState>(
        state::system::Booting{boot_progress_});
  }
}

state::TagStateHandle Application::GetTagState() const {
  // TODO: Proper conversion from internal to public state types
  // For now, return NoTag as placeholder
  return std::make_shared<state::TagState>(state::tag::NoTag{});
}

state::MachineStateHandle Application::GetMachineState() const {
  // TODO: Proper conversion from session:: to state:: types
  // For now, return a simple Idle state
  return std::make_shared<state::MachineState>(state::machine::Idle{});
}

tl::expected<void, ErrorType> Application::RequestManualCheckOut() {
  // TODO: Implement manual check-out request
  return {};
}

void Application::RequestCancelCurrentOperation() {
  // TODO: Implement cancel operation
}

void Application::SetBootProgress(std::string message) {
  boot_progress_ = message;
  logger.info("Boot progress: %s", boot_progress_.c_str());
}
void Application::BootCompleted() { boot_progress_.clear(); }
bool Application::IsBootCompleted() { return boot_progress_.empty(); }
std::string Application::GetBootProgress() { return boot_progress_; }

}  // namespace oww::logic
