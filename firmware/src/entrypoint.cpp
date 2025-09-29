/**
 * @brief Entrypoint for terminal firmware.
 */

#include "common.h"
#include "faulthandler.h"
#include "logic/application.h"
#include "nfc/nfc_tags.h"
#include "setup/setup.h"
#include "ui/ui.h"

#ifdef REMOTE_LOGGING
#include "RemoteLogRK.h"
#endif
// Let Device OS manage the connection to the Particle Cloud
SYSTEM_MODE(AUTOMATIC);
STARTUP(WiFi.selectAntenna(ANT_AUTO));

SerialLogHandler logHandler(
    // Logging level for non-application messages
    LOG_LEVEL_WARN, {
                        {"app", LOG_LEVEL_INFO},
                        {"cloud_request", LOG_LEVEL_INFO},
                        {"config", LOG_LEVEL_INFO},
                        {"display", LOG_LEVEL_INFO},
                        {"nfc", LOG_LEVEL_INFO},
                        {"pn532", LOG_LEVEL_INFO},
                        {"cap1296", LOG_LEVEL_INFO},
                    });

using namespace oww::logic;
using namespace oww::nfc;

#ifdef REMOTE_LOGGING
retained uint8_t remoteLogBuf[2560];
RemoteLog remoteLog(remoteLogBuf, sizeof(remoteLogBuf));
RemoteLogEventServer remoteLogEventServer("debugLog");
#endif

std::shared_ptr<Application> app_;

void setup() {
#ifdef REMOTE_LOGGING
  remoteLog.withServer(&remoteLogEventServer).setup();
#endif
  oww::fault::Init();

  Log.info("machine-auth-firmware starting");

  {
    // create app_
    app_ = std::make_shared<Application>(std::make_unique<Configuration>());
    app_->Begin();
  }

  if (app_->GetConfiguration()->IsSetupMode()) {
    oww::setup::setup(app_);
    return;
  }

  auto display_setup_result = oww::ui::UserInterface::instance().Begin(app_);

#if defined(DEVELOPMENT_BUILD)
  // Await the terminal connections, so that all log messages during setup are
  // not skipped.
  app_->SetBootProgress("Warte auf Debugger...");
  waitFor(Serial.isConnected, 5000);
#endif

  if (!display_setup_result) {
    Log.info("Failed to start display = %d", (int)display_setup_result.error());
  }

  app_->SetBootProgress("Start NFC...");
  Status nfc_setup_result =
      NfcTags::instance().Begin(app_->GetConfiguration()->GetTerminalKey());
  Log.info("NFC Status = %d", (int)nfc_setup_result);

  if (nfc_setup_result != Status::kOk) {
    app_->SetBootProgress("Fehler: NFC Initialisierung!");
    delay(2000);
    System.reset();
  }

  app_->SetBootProgress("Verbinde mit WiFi...");
  waitUntil(WiFi.ready);

  app_->SetBootProgress("Verbinde mit Cloud...");
  waitUntil(Particle.connected);

  app_->SetBootProgress("Warte auf Terminal Config...");
  waitUntil(app_->GetConfiguration()->GetTerminal);

  app_->BootCompleted();
}

system_tick_t next_telemetry_log = 0;

void loop() {
#ifdef REMOTE_LOGGING
  remoteLog.loop();
#endif
  if (app_->GetConfiguration()->IsSetupMode()) {
    oww::setup::loop();
    return;
  }

  app_->Loop();

  auto now = millis();
  if (Log.isInfoEnabled() && now > next_telemetry_log) {
    next_telemetry_log = ((now / 1000) + 5) * 1000;
#if defined(DEVELOPMENT_BUILD)

    WiFiSignal signal = WiFi.RSSI();

    Log.info(
        "System Telemetry\n"
        "  Wifi signal strength: %.02f%% (%fdBm)\n"
        "  WiFi signal quality: %.02f%%",
        signal.getStrength(), signal.getStrengthValue(), signal.getQuality());
#endif
  }
}
