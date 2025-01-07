/**
 * @brief Entrypoint for terminal firmware.
 */

#include "Particle.h"
#include "config.h"
#include "libnfc.h"

// Let Device OS manage the connection to the Particle Cloud
SYSTEM_MODE(AUTOMATIC);

PN532 nfc_chip = PN532(&HW_NFC_SERIAL, HW_NFC_RESET, HW_NFC_IRQ);

SerialLogHandler logHandler(
    LOG_LEVEL_WARN,
    {
        // Logging level for non-application messages
        {"app", LOG_LEVEL_ALL},   // Logging level for application messages
        {PN532_LOGTAG, LOG_LEVEL_ALL}  // Logging level for application messages
    });

void setup() {
#if defined(DEVELOPMENT_BUILD)
  // Await the terminal connections, so that all log messages during setup are
  // not skipped.
  waitFor(Serial.isConnected, 15000);
#endif
  Log.info("machine-auth-firmware starting");
  Status status = nfc_chip.Begin();
  Log.info("NFC status = %d", (int)status);

}

void loop() {}
