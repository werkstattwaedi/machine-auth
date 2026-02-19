// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/system/system.h"

#include <signal.h>
#include <stdio.h>
#include <unistd.h>

#include <chrono>
#include <functional>
#include <thread>

#include <cstring>

#include "device_config/device_config.h"
#include "lvgl.h"
#include "maco_firmware/modules/device_secrets/device_secrets_mock.h"
#include "maco_firmware/modules/gateway/derive_ascon_key.h"
#include "maco_firmware/modules/gateway/host_gateway_client.h"
#include "maco_firmware/modules/led/led.h"
#include "maco_firmware/modules/buzzer/mock/mock_buzzer.h"
#include "maco_firmware/modules/machine_relay/mock/mock_machine_relay.h"
#include "maco_firmware/modules/nfc_reader/mock/mock_nfc_reader.h"
#include "maco_firmware/modules/nfc_reader/mock/nfc_mock_service.h"
#include "maco_firmware/services/maco_service.h"
#include "maco_firmware/targets/host/host_random.h"
#include "maco_firmware/targets/host/host_system_monitor.h"
#include "maco_firmware/targets/host/keyboard_input_driver.h"
#include "maco_firmware/targets/host/sdl_display_driver.h"
#include "maco_firmware/targets/host/sdl_led_driver.h"
#include "device_config/device_config_nanopb_fields.h"
#include "mock_ledger_backend.h"
#include "pb_cloud/ledger_typed_api.h"
#include "firebase/firebase_client.h"
#include "pw_assert/check.h"
#include "pw_log/log.h"
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
  static maco::nfc::NfcMockService nfc_mock_service(
      mock_reader, maco::system::GetRandomGenerator());
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
  auto& display =
      static_cast<maco::display::SdlDisplayDriver&>(GetDisplayDriver());
  static maco::display::KeyboardInputDriver driver(display);
  return driver;
}

const pw::thread::Options& GetDefaultThreadOptions() {
  static const pw::thread::stl::Options options;
  return options;
}

const pw::thread::Options& GetDisplayRenderThreadOptions() {
  static const pw::thread::stl::Options options;
  return options;
}

maco::nfc::NfcReader& GetNfcReader() {
  static maco::nfc::MockNfcReader reader;
  return reader;
}

pb::cloud::MockLedgerBackend& GetMockLedgerBackend() {
  static pb::cloud::MockLedgerBackend backend;
  return backend;
}

maco::config::DeviceConfig& GetDeviceConfig() {
  // Well-known test device ID (12 bytes)
  static constexpr auto kTestDeviceId = std::array<std::byte, 12>{
      std::byte{0x00}, std::byte{0x01}, std::byte{0x02}, std::byte{0x03},
      std::byte{0x04}, std::byte{0x05}, std::byte{0x06}, std::byte{0x07},
      std::byte{0x08}, std::byte{0x09}, std::byte{0x0A}, std::byte{0x0B},
  };
  static auto device_id = maco::DeviceId::FromArray(kTestDeviceId);

  static maco::config::DeviceConfig config(
      GetMockLedgerBackend(), device_id,
      [] { PW_LOG_INFO("Config updated, would reboot"); });

  static bool loaded = false;
  if (!loaded) {
    // Pre-populate mock ledger with CBOR-wrapped base64 protobuf test config
    maco_proto_particle_DeviceConfig test_config =
        maco_proto_particle_DeviceConfig_init_zero;
    test_config.hw_revision =
        maco_proto_particle_HwRevision_HW_REVISION_PROTOTYPE;
    std::strncpy(test_config.gateway_host, "127.0.0.1",
                 sizeof(test_config.gateway_host) - 1);
    test_config.gateway_port = 5000;

    auto write_status =
        pb::cloud::WriteLedgerProtoB64<maco_proto_particle_DeviceConfig>(
            GetMockLedgerBackend(), "terminal-config",
            "device_config.proto.b64", test_config);
    if (!write_status.ok()) {
      PW_LOG_WARN("Failed to write test config: %d",
                  static_cast<int>(write_status.code()));
    }

    config.Init().IgnoreError();
    loaded = true;
  }
  return config;
}

maco::gateway::GatewayClient& GetGatewayClient() {
  auto& dc = GetDeviceConfig();
  auto secret = GetDeviceSecrets().GetGatewayMasterSecret();
  PW_CHECK_OK(secret.status(), "Mock secrets not available");
  static const auto ascon_key =
      maco::gateway::DeriveAsconKey(secret->bytes(), dc.device_id());

  // Use defaults if ledger was empty
  auto host = dc.gateway_host();
  auto port = dc.gateway_port();

  static maco::gateway::GatewayConfig config{
      .host = host.empty() ? "127.0.0.1" : host,
      .port = port != 0 ? static_cast<uint16_t>(port)
                         : static_cast<uint16_t>(5000),
      .connect_timeout_ms = 5000,
      .read_timeout_ms = 5000,
      .device_id = dc.device_id(),
      .key = ascon_key,
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

maco::buzzer::Buzzer& GetBuzzer() {
  static maco::buzzer::MockBuzzer buzzer;
  return buzzer;
}

maco::app_state::SystemMonitorBackend& GetSystemMonitorBackend() {
  static maco::HostSystemMonitor monitor;
  return monitor;
}

}  // namespace maco::system
