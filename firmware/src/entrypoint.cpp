/**
 * @brief Entrypoint for terminal firmware.
 */

#include "common.h"
#include "nfc/nfc_tags.h"
#include "setup/setup.h"
#include "state/state.h"
#include "ui/driver/cap1296.h"
#include "ui/ui.h"

// Let Device OS manage the connection to the Particle Cloud
SYSTEM_MODE(AUTOMATIC);

SerialLogHandler logHandler(
    // Logging level for non-application messages
    LOG_LEVEL_INFO, {
                        {"app", LOG_LEVEL_ALL},
                        {"cloud_request", LOG_LEVEL_ALL},
                        {"config", LOG_LEVEL_ALL},
                        {"display", LOG_LEVEL_WARN},
                        {"nfc", LOG_LEVEL_WARN},
                        {"pn532", LOG_LEVEL_WARN},
                        {"cap1296", LOG_LEVEL_ALL},
                    });

using namespace oww::state;
using namespace oww::ui::driver::cap;

std::shared_ptr<State> state_;
CAP1296 cap;

void setup() {
  Log.info("machine-auth-firmware starting");

  {
    // create state_
    state_ = std::make_shared<State>();
    auto config = std::make_unique<Configuration>(std::weak_ptr(state_));
    state_->Begin(std::move(config));
  }

  if (state_->GetConfiguration()->IsSetupMode()) {
    oww::setup::setup(state_);
    return;
  }

  auto display_setup_result = oww::ui::UserInterface::instance().Begin(state_);

#if defined(DEVELOPMENT_BUILD)
  // Await the terminal connections, so that all log messages during setup are
  // not skipped.
  state_->SetBootProgress("Warte auf Debugger...");
  waitFor(Serial.isConnected, 5000);
#endif

  if (!display_setup_result) {
    Log.info("Failed to start display = %d", (int)display_setup_result.error());
  }

  if (cap.Begin() != Status::kOk) {
    Log.info("Failed to start touch");
  }

  state_->SetBootProgress("Start NFC...");
  Status nfc_setup_result = NfcTags::instance().Begin(state_);
  Log.info("NFC Status = %d", (int)nfc_setup_result);
  state_->SetBootProgress("Verbinde mit WiFi...");

  while (!WiFi.ready()) {
    delay(10);
  }

  state_->SetBootProgress("Verbinde mit Cloud...");

  while (!Particle.connected()) {
    delay(10);
  }

  state_->SetBootProgress("Warte auf Terminal Config...");

  while (!state_->GetConfiguration()->GetTerminal()) {
    delay(10);
  }

  state_->BootCompleted();
}
uint8_t last_touched = 0;
uint8_t current_touched = 0;
void loop() {
  if (state_->GetConfiguration()->IsSetupMode()) {
    oww::setup::loop();
    return;
  }

  state_->Loop();

  current_touched = cap.Touched();

  for (uint8_t i = 0; i < 6; i++) {
    uint8_t mask = 0x01 << i;
    if ((current_touched & mask) && !(last_touched & mask)) {
      Log.info("%d touched", i);
    }
    if (!(current_touched & mask) && (last_touched & mask)) {
      Log.info("%d released", i);
    }
  }

  last_touched = current_touched;
}
