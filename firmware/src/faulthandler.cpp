// Fault handler and retained log replay that uses Particle logging (no Serial)

#include "faulthandler.h"

#include <stdarg.h>
#include <stdint.h>

#include "Particle.h"

using spark::Logger;

namespace oww {
namespace fault {

struct CrashRecord {
  uint32_t magic;  // CRASH_MAGIC when valid
  uint32_t r0, r1, r2, r3, r12, lr, pc, xpsr;
  uint32_t msp, psp;
  uint32_t cfsr, hfsr, mmfar, bfar, afsr;
  uint32_t systick_ctrl, systick_load, systick_val;
  uint32_t timestamp_ms;
};

#define CRASH_MAGIC 0xC0FFEE01u

retained CrashRecord g_crash = {0};

// Retained logs.
#define OWW_RETAINED_LOG_LINES 32
#define OWW_RETAINED_LOG_LINE_LEN 72

#define RET_LOG_MAGIC 0xB10CAFE5u

typedef struct {
  uint32_t magic;
  uint32_t write_idx;
  uint32_t count;
  char lines[OWW_RETAINED_LOG_LINES][OWW_RETAINED_LOG_LINE_LEN];
} RetainedLog;

retained RetainedLog g_retained_log = {0};

static inline void retained_log_init_once() {
  if (g_retained_log.magic != RET_LOG_MAGIC) {
    memset(&g_retained_log, 0, sizeof(g_retained_log));
    g_retained_log.magic = RET_LOG_MAGIC;
  }
}
static inline void retained_log_put_raw(const char* s) {
  retained_log_init_once();
  size_t n = strlen(s);
  if (n >= OWW_RETAINED_LOG_LINE_LEN) n = OWW_RETAINED_LOG_LINE_LEN - 1;
  char* dst = g_retained_log.lines[g_retained_log.write_idx];
  memcpy(dst, s, n);
  dst[n] = '\0';
  g_retained_log.write_idx =
      (g_retained_log.write_idx + 1) % OWW_RETAINED_LOG_LINES;
  if (g_retained_log.count < OWW_RETAINED_LOG_LINES) {
    g_retained_log.count++;
  }
}

// ----- Custom LogHandler capturing messages into retained RAM -----
class RetainedRingLogHandler : public spark::LogHandler {
 public:
  explicit RetainedRingLogHandler(LogLevel level = LOG_LEVEL_INFO)
      : spark::LogHandler(level) {}

  RetainedRingLogHandler(LogLevel level, spark::LogCategoryFilters filters)
      : spark::LogHandler(level, filters) {}

 protected:
  virtual void logMessage(const char* msg, LogLevel level, const char* category,
                          const LogAttributes& attr) override {
    // Format a compact line, avoiding dynamic allocation
    // [ms] <lvl> [cat] msg
    const unsigned long ms = millis();
    const char* lvl = levelName(level);
    const char* cat = category ? category : "app";
    char line[OWW_RETAINED_LOG_LINE_LEN];
    // Truncate message if needed
    snprintf(line, sizeof(line), "[%lu] %s [%s] %s", ms, lvl, cat,
             msg ? msg : "");
    retained_log_put_raw(line);
  }
};

// Global instance: constructed very early, before setup()
static RetainedRingLogHandler s_retained_handler(LOG_LEVEL_ALL);

static Logger CrashLog("crash");

static void log_hex32(const char* name, uint32_t v) {
  CrashLog.error("%s 0x%08lx", name, (unsigned long)v);
}

static void log_crash_record(const CrashRecord& c) {
  CrashLog.error("==== Retained crash record ====");
  log_hex32("R0", c.r0);
  log_hex32("R1", c.r1);
  log_hex32("R2", c.r2);
  log_hex32("R3", c.r3);
  log_hex32("R12", c.r12);
  log_hex32("LR", c.lr);
  log_hex32("PC", c.pc);
  log_hex32("xPSR", c.xpsr);
  log_hex32("MSP", c.msp);
  log_hex32("PSP", c.psp);
  log_hex32("CFSR", c.cfsr);
  log_hex32("HFSR", c.hfsr);
  log_hex32("MMFAR", c.mmfar);
  log_hex32("BFAR", c.bfar);
  log_hex32("AFSR", c.afsr);
  log_hex32("SysTick CTRL", c.systick_ctrl);
  log_hex32("SysTick LOAD", c.systick_load);
  log_hex32("SysTick VAL", c.systick_val);
  CrashLog.error("Uptime at fault: %lu ms", (unsigned long)c.timestamp_ms);
  CrashLog.error("addr2line: 0x%08lx 0x%08lx", (unsigned long)c.pc,
                 (unsigned long)c.lr);
}

void Init() {
  bool hadCrash = (g_crash.magic == CRASH_MAGIC);

  bool waitForDebugger = hadCrash;
#if defined(DEVELOPMENT_BUILD)
  waitForDebugger = true;
#endif

  if (waitForDebugger) {
    waitFor(Serial.isConnected, 5000);
  }
  
  if (hadCrash) {
    log_crash_record(g_crash);
    // Clear to avoid repeating on every boot
    memset(&g_crash, 0, sizeof(g_crash));
  } else {
    // Log the previous reset reason for context
    CrashLog.warn("Previous reset reason: %d", (int)System.resetReason());
  }

  retained_log_init_once();
  // Always replay retained recent logs on boot if present
  if (g_retained_log.count > 0) {
    Logger Replay("replay");
    Replay.warn("---- Retained logs (last %lu) ----",
                (unsigned long)g_retained_log.count);
    uint32_t start = (g_retained_log.write_idx + OWW_RETAINED_LOG_LINES -
                      g_retained_log.count) %
                     OWW_RETAINED_LOG_LINES;
    for (uint32_t i = 0; i < g_retained_log.count; ++i) {
      const char* line =
          g_retained_log.lines[(start + i) % OWW_RETAINED_LOG_LINES];
      if (line[0] != '\0') {
        // Emit via logging so it goes to the configured sinks (no Serial
        // direct)
        Replay.info("%s", line);
      }
    }
    Replay.warn("---- End retained logs ----");
  }
}

}  // namespace fault
}  // namespace oww

// ---------- C handler called from the naked HardFault ISR ----------
extern "C" void hardfault_record_and_reboot(uint32_t* stacked_regs,
                                            uint32_t lr_val, uint32_t msp,
                                            uint32_t psp) {
  using namespace oww::fault;
  // Stacked registers: r0,r1,r2,r3,r12,lr,pc,xpsr
  g_crash.magic = CRASH_MAGIC;
  g_crash.r0 = stacked_regs[0];
  g_crash.r1 = stacked_regs[1];
  g_crash.r2 = stacked_regs[2];
  g_crash.r3 = stacked_regs[3];
  g_crash.r12 = stacked_regs[4];
  g_crash.lr = stacked_regs[5];
  g_crash.pc = stacked_regs[6];
  g_crash.xpsr = stacked_regs[7];

  g_crash.msp = msp;
  g_crash.psp = psp;

  // System Control Block fault registers
  g_crash.cfsr = SCB->CFSR;
  g_crash.hfsr = SCB->HFSR;
  g_crash.mmfar = SCB->MMFAR;
  g_crash.bfar = SCB->BFAR;
  g_crash.afsr = SCB->AFSR;

  // Some extra breadcrumbs
  g_crash.systick_ctrl = SysTick->CTRL;
  g_crash.systick_load = SysTick->LOAD;
  g_crash.systick_val = SysTick->VAL;

  g_crash.timestamp_ms = millis();

  // Minimal breadcrumb into retained ring (avoid full logging in fault context)
  char mini[80];
  snprintf(mini, sizeof(mini), "HardFault PC=0x%08lx LR=0x%08lx",
           (unsigned long)g_crash.pc, (unsigned long)g_crash.lr);
  retained_log_put_raw(mini);

  // Reset to reboot cleanly
  NVIC_SystemReset();
}

// ---------- HardFault ISR (naked) ----------
extern "C" __attribute__((naked)) void HardFault_Handler(void) {
  __asm volatile(
      "tst lr, #4\n"
      "ite eq\n"
      "mrseq r0, msp\n"
      "mrsne r0, psp\n"
      "mov   r1, lr\n"
      "mrs   r2, msp\n"
      "mrs   r3, psp\n"
      "b     hardfault_record_and_reboot\n");
}

#if defined(TaskHandle_t)
#if 0
// Optional FreeRTOS hook (disabled to avoid build issues if FreeRTOS symbols not visible)
extern "C" void vApplicationStackOverflowHook(TaskHandle_t xTask, char* pcTaskName) {
  using namespace oww::fault;
  (void)xTask;
  g_crash.magic = CRASH_MAGIC;
  g_crash.pc = 0xDEAD0001;  // tag for overflow
  if (pcTaskName) {
    strncpy((char*)&g_crash.r0, pcTaskName, sizeof(uint32_t) * 2);
  }
  retained_log_put_raw("Stack overflow detected; resetting");
  NVIC_SystemReset();
}
#endif
#endif