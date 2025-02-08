/**
 * @brief Entrypoint for terminal firmware.
 */

#include "Particle.h"
#include "config.h"
#include "display/display.h"
#include "nfc/nfc_tags.h"
#include "state/state.h"

// Let Device OS manage the connection to the Particle Cloud
SYSTEM_MODE(AUTOMATIC);

SerialLogHandler logHandler(
    // Logging level for non-application messages
    LOG_LEVEL_WARN, {
                        {"app", LOG_LEVEL_ALL},
                        {PN532_LOGTAG, LOG_LEVEL_ALL},
                        // {config::display::logtag, LOG_LEVEL_ALL},
                        {oww::state::configuration::logtag, LOG_LEVEL_ALL},
                    });

using namespace oww::state;

std::shared_ptr<State> state_;

void setup() {
#if defined(DEVELOPMENT_BUILD)
  // Await the terminal connections, so that all log messages during setup are
  // not skipped.
  waitFor(Serial.isConnected, 5000);
#endif
  Log.info("machine-auth-firmware starting");

  {
    // create state_
    state_.reset(new State());

    auto config = std::make_unique<Configuration>(std::weak_ptr(state_));

    state_->Begin(std::move(config));
  }

  Status display_setup_result =
      Display::instance().Begin(state_);
  Log.info("Display Status = %d", (int)display_setup_result);

  Status nfc_setup_result = NfcTags::instance().Begin(state_);
  Log.info("NFC Status = %d", (int)nfc_setup_result);
}

void loop() { state_->Loop(); }
