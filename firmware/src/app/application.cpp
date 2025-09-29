
#include "app/application.h"

#include "common/byte_array.h"
#include "fbs/ledger_terminal-config_generated.h"

namespace oww::app {

Logger Application::logger("app");

Application::Application(std::unique_ptr<Configuration> configuration)
    : boot_progress_("Starte..."),
      configuration_(std::move(configuration)),
      cloud_request_(),
      sessions_(),
      machine_usage_(this)

{}

Status Application::Begin() {
  os_mutex_create(&mutex_);

  auto device_config = configuration_->GetDeviceConfig();
  auto machine = (device_config->machines()->begin());

  configuration_->Begin();
  sessions_.Begin();
  machine_usage_.Begin(**machine);
  cloud_request_.Begin();

  return Status::kOk;
}

void Application::Loop() {
  cloud_request_.Loop();
  sessions_.Loop();
  machine_usage_.Loop();
}

void Application::SetBootProgress(std::string message) {
  boot_progress_ = message;
  logger.info("Boot progress: %s", boot_progress_.c_str());
}
void Application::BootCompleted() { boot_progress_.clear(); }
bool Application::IsBootCompleted() { return boot_progress_.empty(); }
std::string Application::GetBootProgress() { return boot_progress_; }

}  // namespace oww::app
