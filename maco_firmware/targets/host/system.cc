// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/system/system.h"

#include <signal.h>
#include <stdio.h>
#include <unistd.h>

#include <chrono>
#include <functional>
#include <thread>

#include "lvgl.h"
#include "maco_firmware/modules/app_state/app_state.h"
#include "maco_firmware/modules/device_secrets/device_secrets_mock.h"
#include "maco_firmware/services/maco_service.h"
#include "maco_firmware/modules/gateway/host_gateway_client.h"
#include "maco_firmware/modules/nfc_reader/mock/mock_nfc_reader.h"
#include "maco_firmware/modules/nfc_reader/mock/nfc_mock_service.h"
#include "maco_firmware/modules/led/led.h"
#include "maco_firmware/modules/machine_relay/mock/mock_machine_relay.h"
#include "maco_firmware/targets/host/host_random.h"
#include "maco_firmware/targets/host/keyboard_input_driver.h"
#include "maco_firmware/targets/host/sdl_display_driver.h"
#include "maco_firmware/targets/host/sdl_led_driver.h"
#include "firebase/firebase_client.h"
#include "pb_crypto/pb_crypto.h"
#include "pw_assert/check.h"
#include "pw_channel/stream_channel.h"
#include "pw_multibuf/simple_allocator.h"
#include "pw_system/io.h"
#include "pw_system/system.h"
#include "pw_thread_stl/options.h"


extern "C" {

void CtrlCSignalHandler(int /* ignored */) {
  printf("\nCtrl-C received; simulator exiting immediately...\n");
  // Skipping the C++ destructors since we want to exit immediately.
  _exit(0);
}

}  // extern "C"

void InstallCtrlCSignalHandler() {
  // Catch Ctrl-C to force a 0 exit code (success) to avoid signaling an error
  // for intentional exits. For example, VSCode shows an alarming dialog on
  // non-zero exit, which is confusing for users intentionally quitting.
  signal(SIGINT, CtrlCSignalHandler);
}

namespace {

// pw_system thread - runs RPC and system services in background
void PwSystemThread() {
  static std::byte channel_buffer[16384];
  static pw::multibuf::SimpleAllocator multibuf_alloc(
      channel_buffer, pw::System().allocator());
  static pw::NoDestructor<pw::channel::StreamChannel> channel(
      multibuf_alloc,
      pw::system::GetReader(),
      pw::thread::stl::Options(),
      pw::system::GetWriter(),
      pw::thread::stl::Options());

  // Register RPC services
  static maco::MacoService maco_service;
  pw::System().rpc_server().RegisterService(maco_service);

  // Register NFC Mock Service (host-only)
  auto& mock_reader =
      static_cast<maco::nfc::MockNfcReader&>(maco::system::GetNfcReader());
  static maco::nfc::NfcMockService nfc_mock_service(mock_reader);
  pw::System().rpc_server().RegisterService(nfc_mock_service);

  pw::system::StartAndClobberTheStack(channel->channel());
}

// Main SDL loop - must run on main thread for SDL event handling
// Note: LVGL tick and timer handling is done by Display module's render thread
[[noreturn]] void RunSdlLoop(maco::display::SdlDisplayDriver& display) {
  using namespace std::chrono_literals;
  constexpr auto kFramePeriod = 16ms;  // ~60 FPS

  while (true) {
    // Handle SDL events (window close, etc.) - must be on main thread
    display.PumpEvents();
    if (display.quit_requested()) {
      printf("\nWindow closed, exiting...\n");
      _exit(0);
    }

    // Present frame to screen
    display.Present();

    // Frame rate limiter
    std::this_thread::sleep_for(kFramePeriod);
  }
}

}  // namespace

namespace maco::system {

void Init(pw::Function<void()> app_init) {
  app_init();

  InstallCtrlCSignalHandler();

  printf("=====================================\n");
  printf("=== MaCo: Host Simulator ===\n");
  printf("=====================================\n");
  printf("Press Ctrl-C or close window to exit\n");
  fflush(stdout);

  // Start pw_system in background thread
  static std::thread pw_system_thread(PwSystemThread);
  pw_system_thread.detach();

  // Run SDL/LVGL loop on main thread (required for SDL event handling)
  auto& display =
      static_cast<maco::display::SdlDisplayDriver&>(GetDisplayDriver());
  RunSdlLoop(display);
}

maco::display::DisplayDriver& GetDisplayDriver() {
  static maco::display::SdlDisplayDriver driver;
  return driver;
}

maco::display::TouchButtonDriver& GetTouchButtonDriver() {
  static maco::display::KeyboardInputDriver driver;
  return driver;
}

const pw::thread::Options& GetDefaultThreadOptions() {
  static const pw::thread::stl::Options options;
  return options;
}

maco::nfc::NfcReader& GetNfcReader() {
  static maco::nfc::MockNfcReader reader;
  return reader;
}

maco::app_state::AppState& GetAppState() {
  static maco::app_state::AppState state;
  return state;
}

maco::gateway::GatewayClient& GetGatewayClient() {
  // Master secret for key derivation (same as P2 for testing)
  static constexpr std::array<std::byte, 16> kMasterSecret = {
      std::byte{0x00}, std::byte{0x01}, std::byte{0x02}, std::byte{0x03},
      std::byte{0x04}, std::byte{0x05}, std::byte{0x06}, std::byte{0x07},
      std::byte{0x08}, std::byte{0x09}, std::byte{0x0A}, std::byte{0x0B},
      std::byte{0x0C}, std::byte{0x0D}, std::byte{0x0E}, std::byte{0x0F},
  };

  static constexpr uint64_t kDeviceId = 0x0001020304050607ULL;

  // Derive per-device ASCON key
  static auto derive_key = []() {
    std::array<std::byte, 24> key_material;
    std::copy(kMasterSecret.begin(), kMasterSecret.end(), key_material.begin());

    for (int i = 7; i >= 0; --i) {
      key_material[16 + (7 - i)] =
          static_cast<std::byte>((kDeviceId >> (i * 8)) & 0xFF);
    }

    std::array<std::byte, pb::crypto::kAsconHashSize> hash;
    auto status = pb::crypto::AsconHash256(key_material, hash);
    PW_CHECK_OK(status, "Key derivation failed");

    std::array<std::byte, pb::crypto::kAsconKeySize> key;
    std::copy(hash.begin(), hash.begin() + key.size(), key.begin());
    return key;
  };
  static const auto ascon_key = derive_key();

  // Gateway configuration - connect to local gateway for testing
  static maco::gateway::GatewayConfig config{
      .host = "127.0.0.1",
      .port = 5000,
      .connect_timeout_ms = 5000,
      .read_timeout_ms = 5000,
      .device_id = kDeviceId,
      .key = ascon_key.data(),
      .channel_id = 1,
  };

  static maco::gateway::HostGatewayClient gateway_client(config);
  return gateway_client;
}

maco::firebase::FirebaseClient& GetFirebaseClient() {
  auto& gateway = GetGatewayClient();
  static maco::firebase::FirebaseClient firebase_client(
      gateway.rpc_client(), gateway.channel_id());
  return firebase_client;
}

const pw::thread::Options& GetLedThreadOptions() {
  static const pw::thread::stl::Options options;
  return options;
}

auto& GetLed() {
  static maco::led::SdlLedDriver<16> driver;
  static maco::led::Led<maco::led::SdlLedDriver<16>> led(driver);
  return led;
}

pw::random::RandomGenerator& GetRandomGenerator() {
  static maco::HostRandomGenerator generator;
  return generator;
}

maco::secrets::DeviceSecrets& GetDeviceSecrets() {
  static maco::secrets::DeviceSecretsMock mock_secrets;
  return mock_secrets;
}

maco::machine_relay::MachineRelay& GetMachineRelay() {
  static maco::machine_relay::MockMachineRelay relay;
  return relay;
}

}  // namespace maco::system
