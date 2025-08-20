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

  new Thread(
      "spi_flush",
      []() {
        while (true) {
          delay(5000);
          Display::instance().LogStat();
        }
      },
      OS_THREAD_PRIORITY_DEFAULT);
}

int loop_count = 0;
system_tick_t time_next_log = 0;
system_tick_t time_next_frame = 0;

void loop() {
  auto now = millis();

  loop_count++;

  // Heartbeat logging every second
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

  // Run LVGL timer handler only when it's time (non-blocking approach)
  if (now >= time_next_frame) {
    uint32_t time_till_next = lv_timer_handler();
    time_next_frame = now + time_till_next;
  }

  // Yield to other tasks briefly but don't block
  delay(1);
}
