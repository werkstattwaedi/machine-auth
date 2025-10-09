#include "faulthandler.h"
#include "config.h"
#include <stdarg.h>
#include <stdint.h>

#include "Particle.h"

using spark::Logger;

namespace oww {
namespace fault {

void Init() {
  std::string message;

  bool hadCrash = false;
  switch (System.resetReason()) {
    case RESET_REASON_NONE:
      message = "Invalid reason code";
      break;
    case RESET_REASON_UNKNOWN:
      message = "Unspecified reason";
      break;
    case RESET_REASON_PIN_RESET:
      message = "Reset from the reset pin";
      break;
    case RESET_REASON_POWER_MANAGEMENT:
      message = "Low-power management reset";
      break;
    case RESET_REASON_POWER_DOWN:
      message = "Power-down reset";
      break;
    case RESET_REASON_POWER_BROWNOUT:
      message = "Brownout reset";
      break;
    case RESET_REASON_WATCHDOG:
      message = "Watchdog reset";
      break;
    case RESET_REASON_UPDATE:
      message = "Reset to apply firmware update";
      break;
    case RESET_REASON_UPDATE_ERROR:
      message = "Generic firmware update error (deprecated)";
      break;
    case RESET_REASON_UPDATE_TIMEOUT:
      message = "Firmware update timeout";
      break;
    case RESET_REASON_FACTORY_RESET:
      message = "Factory reset requested";
      break;
    case RESET_REASON_SAFE_MODE:
      message = "Safe mode requested";
      break;
    case RESET_REASON_DFU_MODE:
      message = "DFU mode requested";
      break;
    case RESET_REASON_PANIC: {
      hadCrash = true;
      switch (System.resetReasonData()) {
        case 1:
          message = "HardFault";
          break;
        case 2:
          message = "NMIFault";
          break;
        case 3:
          message = "MemManage";
          break;
        case 4:
          message = "BusFault";
          break;
        case 5:
          message = "UsageFault";
          break;
        case 6:
          message = "InvalidLenth";
          break;
        case 7:
          message = "Exit";
          break;
        case 8:
          message = "OutOfHeap";
          break;
        case 9:
          message = "SPIOverRun";
          break;
        case 10:
          message = "AssertionFailure";
          break;
        case 11:
          message = "InvalidCase";
          break;
        case 12:
          message = "PureVirtualCall";
          break;
        case 13:
          message = "StackOverflow";
          break;
        case 14:
          message = "HeapError";
          break;
        case 15:
          message = "SecureFault";
          break;
      }

    } break;
    case RESET_REASON_USER:
      message = "User-requested reset";
      break;
    case RESET_REASON_CONFIG_UPDATE:
      message = "Reset to apply configuration changes";
      break;
    default:
      message = "code not known";
      break;
  }

#if defined(DEVELOPMENT_BUILD)
  if (hadCrash) {
    while (!Serial.isConnected()) {
    }

    Log.error("Firmware crashed! (Reason: %s)", message.c_str());

    while (true) {
      delay(20s);
    }
  }

  waitFor(Serial.isConnected, 5000);
#endif
  Log.error("Firmware staring. (Reset reason: %s)", message.c_str());
}

}  // namespace fault
}  // namespace oww
