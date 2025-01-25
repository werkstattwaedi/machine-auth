/**
 * @brief Entrypoint for terminal firmware.
 */

#include "Particle.h"
#include "config.h"
#include "display/display.h"
#include "libnfc.h"

// Let Device OS manage the connection to the Particle Cloud
SYSTEM_MODE(AUTOMATIC);

PN532 nfc_chip =
    PN532(&Serial1, config::nfc::pin_reset, config::nfc::pin_reset);

SerialLogHandler logHandler(
    // Logging level for non-application messages
    LOG_LEVEL_WARN, {{"app", LOG_LEVEL_ALL},
                     {PN532_LOGTAG, LOG_LEVEL_ALL},
                     {config::display::logtag, LOG_LEVEL_ALL}});

void setup() {
#if defined(DEVELOPMENT_BUILD)
  // Await the terminal connections, so that all log messages during setup are
  // not skipped.
  waitFor(Serial.isConnected, 5000);
#endif
  Log.info("machine-auth-firmware starting");

  Status display_setup_result = Display::instance().Begin();
  Log.info("Display Status = %d", (int)display_setup_result);

  Status status = nfc_chip.Begin();
  Log.info("NFC status = %d", (int)status);
}

void loop() {}
