
#include "state.h"

#include "common/byte_array.h"

namespace oww::state {

Logger State::logger("state");

State::State() : boot_progress_("Starte...") {}

Status State::Begin(std::unique_ptr<Configuration> configuration) {
  os_mutex_create(&mutex_);

  configuration_ = std::move(configuration);
  configuration_->Begin();

  tag_state_ = std::make_shared<tag::TagState>(tag::Idle{});
  sessions_.Begin();

  pinMode(config::ext::pin_relais, INPUT);
  relais_state_ = digitalRead(config::ext::pin_relais) ? HIGH : LOW;
  if (relais_state_ == HIGH) {
    Log.warn("Relais was ON at startup");
  }

  // TODO: Enable the external I2C bus bases on the configuration.
  pinMode(config::ext::pin_i2c_enable, OUTPUT);
  digitalWrite(config::ext::pin_i2c_enable, HIGH);

  CloudRequest::Begin();

  return Status::kOk;
}

void State::Loop() {
  CheckTimeouts();
  sessions_.Loop();
}

void State::OnConfigChanged() { System.reset(RESET_REASON_CONFIG_UPDATE); }

void State::SetBootProgress(std::string message) {
  boot_progress_ = message;
  logger.info("Boot progress: %s", boot_progress_.c_str());
}
void State::BootCompleted() { boot_progress_.clear(); }
bool State::IsBootCompleted() { return boot_progress_.empty(); }
std::string State::GetBootProgress() { return boot_progress_; }


void State::OnTagFound() {
  tag_state_ = std::make_shared<tag::TagState>(tag::Detected{});
}

void State::OnBlankNtag(std::array<uint8_t, 7> uid) {
}

void State::OnTagAuthenicated(std::array<uint8_t, 7> uid) {
  tag_state_ =
      std::make_shared<tag::TagState>(tag::Authenticated{.tag_uid = uid});
}

void State::OnUnknownTag() {
  tag_state_ = std::make_shared<tag::TagState>(tag::Unknown{});
}

void State::OnTagRemoved() {
  tag_state_ = std::make_shared<tag::TagState>(tag::Idle{});
}

}  // namespace oww::state
