// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <string_view>

#include "pw_chrono/system_clock.h"
#include "pw_function/function.h"
#include "pw_random/random.h"
#include "pw_thread/options.h"

// The functions in this file return specific implementations of singleton types
// provided by the system.

namespace maco::display {
class DisplayDriver;
class TouchButtonDriver;
}  // namespace maco::display

namespace maco::nfc {
class NfcReader;
}  // namespace maco::nfc

namespace maco::firebase {
class FirebaseClient;
}  // namespace maco::firebase

namespace maco::config {
class DeviceConfig;
}  // namespace maco::config

namespace maco::gateway {
class GatewayClient;
}  // namespace maco::gateway

namespace maco::secrets {
class DeviceSecrets;
}  // namespace maco::secrets

namespace maco::machine_control {
class MachineToggle;
}  // namespace maco::machine_control

namespace pb::socket {
class TcpSocket;
}  // namespace pb::socket

namespace maco::buzzer {
class Buzzer;
}  // namespace maco::buzzer

namespace maco::app_state {
class SystemMonitorBackend;
}  // namespace maco::app_state

namespace pw::kvs {
class KeyValueStore;
}  // namespace pw::kvs

namespace maco::led {
// Forward declaration - concrete types are platform-specific (CRTP templates)
// Host: Led<SdlLedDriver<16>>
// P2: Led<In4818LedDriver<16>>
}  // namespace maco::led

namespace maco::led_animator {
class LedAnimatorBase;
}  // namespace maco::led_animator

namespace maco::system {

/// Reason for the most recent device reset.
enum class ResetReason : uint8_t {
  kUnknown,
  kWatchdog,
  kPanic,
  kPowerCycle,
  kOtaUpdate,
  kUserRequested,
};

/// Initializes the system, first performing target-specific initialization,
/// and then invoking the app_init continuation function to perform app-specific
/// initialization. Once that completes and returns, the main system scheduler
/// is started.
///
/// This function never returns, and should be called from the start of `main`.
[[noreturn]] void Init(pw::Function<void()> app_init);

/// Waits up to 10 seconds for a USB serial connection, then flushes any
/// pending data. Useful for ensuring log output is visible during development.
/// Call this after the splash screen is shown so the user sees something
/// while the device waits.
/// P2: Polls HAL_USB_USART, Host: no-op.
void WaitForUsbSerial();

/// Returns the platform-specific display driver instance.
/// Host: SdlDisplayDriver, P2: PicoRes28LcdDriver
maco::display::DisplayDriver& GetDisplayDriver();

/// Returns the platform-specific touch button input driver instance.
/// Host: KeyboardInputDriver, P2: CapTouchInputDriver
maco::display::TouchButtonDriver& GetTouchButtonDriver();

/// Returns the default thread options for the current platform.
/// Host: pw::thread::stl::Options, P2: pw::thread::particle::Options
const pw::thread::Options& GetDefaultThreadOptions();

/// Returns thread options for the display render thread.
/// Needs a larger stack than default for LVGL's render pipeline.
/// Host: pw::thread::stl::Options, P2: 8KB stack
const pw::thread::Options& GetDisplayRenderThreadOptions();

/// Returns the platform-specific NFC reader instance.
/// Host: MockNfcReader, P2: Pn532NfcReader
maco::nfc::NfcReader& GetNfcReader();

/// Returns the cloud-configurable device configuration.
/// P2: Reads from Particle Ledger with hardware device ID
/// Host: Mock ledger with test data
maco::config::DeviceConfig& GetDeviceConfig();

/// Returns the gateway client for MACO Gateway communication.
/// P2: Uses TCP + ASCON encryption via pb_socket
/// Host: Uses TCP + ASCON encryption via POSIX sockets
maco::gateway::GatewayClient& GetGatewayClient();

/// Returns the Firebase client for cloud communication.
/// Uses the gateway client for transport.
maco::firebase::FirebaseClient& GetFirebaseClient();

/// Returns the platform-specific LED module instance.
/// Host: Led<SdlLedDriver<16>>, P2: Led<In4818LedDriver<16>>
auto& GetLed();

/// Returns the thread options for the LED render thread.
/// P2: Higher priority for smooth animations.
const pw::thread::Options& GetLedThreadOptions();

/// Returns the LED animator. Initializes the LED module on first call.
/// The animator is pre-wired as the LED frame renderer.
maco::led_animator::LedAnimatorBase& GetLedAnimator();

/// Returns the platform-specific random number generator.
/// P2: Uses HAL RNG (LFSR seeded from ADC noise at boot)
/// Host: Uses std::random_device (/dev/urandom on Linux)
pw::random::RandomGenerator& GetRandomGenerator();

/// Returns the device secrets storage instance.
/// P2: EEPROM-backed persistent storage
/// Host: Mock implementation for testing
maco::secrets::DeviceSecrets& GetDeviceSecrets();

/// Returns the platform-specific machine toggle controller.
/// P2: LatchingMachineRelay with HAL GPIO
/// Host: MockMachineToggle for simulation
maco::machine_control::MachineToggle& GetMachineToggle();

/// Returns the platform-specific buzzer controller.
/// P2: ToneBuzzer with HAL PWM tone
/// Host: MockBuzzer for simulation
maco::buzzer::Buzzer& GetBuzzer();

/// Returns the platform-specific system monitor backend.
/// P2: Subscribes to Device OS network/cloud/time events
/// Host: Stub that reports everything connected
maco::app_state::SystemMonitorBackend& GetSystemMonitorBackend();

/// Returns the reason for the most recent device reset.
/// P2: Maps HAL_Core_Get_Last_Reset_Info() to ResetReason
/// Host: Always returns kPowerCycle
ResetReason GetResetReason();

/// Records this boot in persistent storage and returns the number of
/// consecutive boots that have NOT yet been confirmed stable (see
/// ScheduleBootStableClear). A healthy device reports 1; a boot loop (repeated
/// resets before the stable window elapses) reports an increasing count. Used
/// by the app to detect a reset loop and fall back to a minimal safe state
/// instead of re-arming the watchdog forever (ADR-0040).
/// P2: EEPROM-backed (survives watchdog/panic/power cycle).
/// Host: no-op, always returns 1.
int RecordBoot();

/// Returns the current consecutive-boot count without modifying it (for
/// diagnostics, e.g. the GetDeviceInfo RPC). 1 on a healthy device.
/// P2: reads the raw-flash counter. Host: always returns 1.
int LastBootCount();

/// Schedules a one-shot clear of the consecutive-boot counter after the device
/// has run for `after`, proving this boot is stable. Post-boot; requires the
/// system dispatcher. Call once during app init regardless of watchdog state.
/// P2: posts a dispatcher coroutine that clears the EEPROM counter.
/// Host: no-op.
void ScheduleBootStableClear(pw::chrono::SystemClock::duration after);

/// Arms the hardware watchdog with `timeout` and starts feeding it from a
/// supervised dispatcher heartbeat: a coroutine on the system dispatcher proves
/// the safety-critical event loop is scheduling work, and a dedicated
/// high-priority thread feeds the watchdog only while that heartbeat advances.
/// A genuinely wedged dispatcher stops the heartbeat, the feed stops, and the
/// watchdog resets the device (ADR-0040). Call after app init completes.
/// P2: hardware IWDG via pb::watchdog::Watchdog.
/// Host: no-op.
void StartWatchdog(pw::chrono::SystemClock::duration timeout);

/// Best-effort stop of the hardware watchdog. Used on the rapid-reset safe path
/// to halt a watchdog that may have been armed on a previous boot and survived
/// the reset, so it can't keep resetting the terminal. May be a no-op on
/// hardware that cannot stop an independent watchdog once started.
/// P2: pb::watchdog::Watchdog::Disable() (calls hal_watchdog_stop).
/// Host: no-op.
void StopWatchdog();

/// Returns the KVS instance for session persistence.
/// P2: External flash via ParticleFlashMemory
/// Host: RAM-backed FakeFlash
pw::kvs::KeyValueStore& GetSessionKvs();

}  // namespace maco::system
