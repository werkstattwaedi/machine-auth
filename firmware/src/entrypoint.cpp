/**
 * @brief Entrypoint for terminal firmware.
 */

#include "common.h"
#include "faulthandler.h"
#include "ui/driver/display.h"
#include "ui/stresstest.h"

// Switch between MANUAL and AUTOMATIC to test SPI stability
#define TEST_AUTOMATIC_MODE 1

#if TEST_AUTOMATIC_MODE
SYSTEM_MODE(AUTOMATIC);
#else
SYSTEM_MODE(MANUAL);
#endif

SerialLogHandler logHandler(LOG_LEVEL_TRACE, {
                                                 {"app", LOG_LEVEL_ALL},
                                                 {"display", LOG_LEVEL_ALL},

                                             });

void setup() {
  oww::fault::Init();

  Log.info("display debug starting");
  Display::instance().Begin();
  Log.info("Display started");

  // Start stress test to generate continuous SPI traffic
  StressTest::Start();
  Log.info("Stress test started");
}

int loop_count = 0;
system_tick_t time_next_log = 0;

void loop() {
  loop_count++;
  auto now = millis();
  if (now > time_next_log) {
#if TEST_AUTOMATIC_MODE
    Log.info("Main Heartbeat %dfps (AUTOMATIC mode), SPI transfers: %lu",
             loop_count, Display::GetTransferCount());
#else
    Log.info("Main Heartbeat %dfps (MANUAL mode), SPI transfers: %lu",
             loop_count, Display::GetTransferCount());
#endif
    time_next_log = ((now / 1000) + 1) * 1000;
    loop_count = 0;
  }

  // Run LVGL timer handler - this processes the stress test animations
  uint32_t time_till_next = lv_timer_handler();
  delay(time_till_next);
}
