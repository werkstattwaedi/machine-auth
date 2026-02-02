// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_function/function.h"
#include "pw_random/random.h"
#include "pw_thread/options.h"

// The functions in this file return specific implementations of singleton types
// provided by the system.

namespace maco::app_state {
class AppState;
}  // namespace maco::app_state

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

namespace maco::gateway {
class GatewayClient;
}  // namespace maco::gateway

namespace maco::secrets {
class DeviceSecrets;
}  // namespace maco::secrets

namespace maco::led {
// Forward declaration - concrete types are platform-specific (CRTP templates)
// Host: Led<SdlLedDriver<16>>
// P2: Led<In4818LedDriver<16>>
}  // namespace maco::led

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

/// Returns the platform-specific NFC reader instance.
/// Host: MockNfcReader, P2: Pn532NfcReader
maco::nfc::NfcReader& GetNfcReader();

/// Returns the global application state instance.
/// Thread-safe: can be read from UI thread, written from main thread.
maco::app_state::AppState& GetAppState();

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

/// Returns the platform-specific random number generator.
/// P2: Uses HAL RNG (LFSR seeded from ADC noise at boot)
/// Host: Uses std::random_device (/dev/urandom on Linux)
pw::random::RandomGenerator& GetRandomGenerator();

/// Returns the device secrets storage instance.
/// P2: EEPROM-backed persistent storage
/// Host: Mock implementation for testing
maco::secrets::DeviceSecrets& GetDeviceSecrets();

}  // namespace maco::system
