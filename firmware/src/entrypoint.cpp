/**
 * @brief Entrypoint for terminal firmware.
 */

#include "Particle.h"
#include "config.h"
#include "libnfc.h"

// Let Device OS manage the connection to the Particle Cloud
SYSTEM_MODE(AUTOMATIC);

SerialLogHandler logHandler(
    LOG_LEVEL_WARN,
    {
        // Logging level for non-application messages
        {"app", LOG_LEVEL_ALL},   // Logging level for application messages
        {"pn532", LOG_LEVEL_ALL}  // Logging level for application messages
    });

void setup() {
#if defined(DEVELOPMENT_BUILD)
  // Await the terminal connections, so that all log messages during setup are
  // not skipped.
  waitFor(Serial.isConnected, 15000);
#endif
}

void loop() {}
