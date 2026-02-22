// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

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

namespace maco::machine_relay {
class MachineRelay;
}  // namespace maco::machine_relay

namespace maco::buzzer {
class Buzzer;
}  // namespace maco::buzzer

namespace maco::app_state {
class SystemMonitorBackend;
}  // namespace maco::app_state

namespace maco::led {
// Forward declaration - concrete types are platform-specific (CRTP templates)
// Host: Led<SdlLedDriver<16>>
// P2: Led<In4818LedDriver<16>>
}  // namespace maco::led

namespace maco::led_animator {
class LedAnimatorBase;
}  // namespace maco::led_animator

namespace maco::system {

/// Initializes the system, first performing target-specific initialization,
/// and then invoking the app_init continuation function to perform app-specific
/// initialization. Once that completes and returns, the main system scheduler
/// is started.
///
/// This function never returns, and should be called from the start of `main`.
[[noreturn]] void Init(pw::Function<void()> app_init);

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

/// Returns the platform-specific machine relay controller.
/// P2: LatchingMachineRelay with HAL GPIO
/// Host: MockMachineRelay for simulation
maco::machine_relay::MachineRelay& GetMachineRelay();

/// Returns the platform-specific buzzer controller.
/// P2: ToneBuzzer with HAL PWM tone
/// Host: MockBuzzer for simulation
maco::buzzer::Buzzer& GetBuzzer();

/// Returns the platform-specific system monitor backend.
/// P2: Subscribes to Device OS network/cloud/time events
/// Host: Stub that reports everything connected
maco::app_state::SystemMonitorBackend& GetSystemMonitorBackend();

}  // namespace maco::system
