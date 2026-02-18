// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/system/system.h"

#include <cstddef>

// Pigweed headers first - before Particle headers that define pin macros
// (D2, D3, etc.) which conflict with Pigweed template parameter names.
#include "pw_async2/system_time_provider.h"
#include "pw_assert/check.h"
#include "pw_channel/stream_channel.h"
#include "pw_log/log.h"
#include "pw_multibuf/simple_allocator.h"
#include "pw_system/io.h"
#include "pw_system/system.h"
#include "pw_thread_particle/options.h"

// Particle and project headers after Pigweed
#include "device_config/device_config.h"
#include "maco_firmware/modules/device_secrets/device_secrets_eeprom.h"
#include "maco_firmware/modules/gateway/derive_ascon_key.h"
#include "maco_firmware/services/maco_service.h"
#include "maco_firmware/devices/cap_touch/cap_touch_input_driver.h"
#include "maco_firmware/devices/in4818/in4818_led_driver.h"
#include "maco_firmware/devices/pico_res28_lcd/pico_res28_lcd_driver.h"
#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"
#include "maco_firmware/modules/led/led.h"
#include "maco_firmware/modules/gateway/p2_gateway_client.h"
#include "maco_firmware/modules/buzzer/tone_buzzer.h"
#include "maco_firmware/modules/machine_relay/latching_machine_relay.h"
#include "maco_firmware/targets/p2/hardware_random.h"
#include "firebase/firebase_client.h"
#include "maco_firmware/types.h"
#include "pb_cloud/particle_ledger_backend.h"
#include "pb_digital_io/digital_io.h"
#include "pb_uart/async_uart.h"
#include "pb_log/log_bridge.h"
#include "pb_i2c/initiator.h"
#include "pb_spi/initiator.h"
#include "i2c_hal.h"
#include "pinmap_hal.h"
#include "core_hal.h"
#include "delay_hal.h"
#include "deviceid_hal.h"
#include "spi_hal.h"
#include "usb_hal.h"

namespace maco::system {

using maco::DeviceId;
using pw::channel::StreamChannel;

namespace {

// Pin definitions for Pico-ResTouch-LCD-2.8 display
// (from original firmware/src/config.h)
constexpr hal_pin_t kPinDisplayReset = S3;        // Display reset
constexpr hal_pin_t kPinDisplayChipSelect = D5;   // Display CS
constexpr hal_pin_t kPinDisplayDataCommand = D10; // Display D/C
constexpr hal_pin_t kPinDisplayBacklight = A5;    // Display backlight

// SPI clock frequency for display (40 MHz typical for ST7789)
constexpr uint32_t kDisplaySpiClockHz = 40'000'000;

// Pin definitions for PN532 NFC controller
// S1 (MISO/D16) is shared with LED SPI - ensure SPI1 is not in use
constexpr hal_pin_t kPinNfcReset = S1;

// UART baud rate for PN532 HSU mode
constexpr uint32_t kNfcUartBaudRate = 115200;

// pw_rpc channel ID for gateway communication
// TODO: Gateway TCP client not yet implemented for Device OS
constexpr uint32_t kGatewayChannelId = 1;

// Pin for machine relay control
constexpr hal_pin_t kPinMachineRelay = A1;

// Pin for PWM buzzer
constexpr hal_pin_t kPinBuzzer = A2;

// Sequential access (log drain) — negligible latency impact in PSRAM.
__attribute__((section(".psram.bss")))
std::byte channel_buffer[16384];

}  // namespace

void Init(pw::Function<void()> app_init) {
  pb::log::InitLogBridge();

  // Dev firmware waits up to 10s for USB serial connection (for logs).
  // TODO - this must be controlled from the APP, not here.
  for (int i = 0; i < 100; i++) {
    if (HAL_USB_USART_Is_Connected(HAL_USB_USART_SERIAL)) {
      break;
    }
    HAL_Delay_Milliseconds(100);
  }

  // Flush any pending data from console that connected before we were ready.
  // This prevents crashes when the device reboots with console already attached.
  if (HAL_USB_USART_Is_Connected(HAL_USB_USART_SERIAL)) {
    while (HAL_USB_USART_Available_Data(HAL_USB_USART_SERIAL) > 0) {
      HAL_USB_USART_Receive_Data(HAL_USB_USART_SERIAL, false);
    }
    HAL_Delay_Milliseconds(100);  // Let console stabilize
  }

  app_init();
  static pw::multibuf::SimpleAllocator multibuf_alloc(
      channel_buffer, pw::System().allocator()
  );

  // Use pw_sys_io based I/O from particle-bazel.
  static pw::NoDestructor<StreamChannel> channel(
      pw::system::GetReader(),
      pw::thread::particle::Options()
          .set_name("rx_thread")
          .set_stack_size(4096),
      multibuf_alloc,
      pw::system::GetWriter(),
      pw::thread::particle::Options()
          .set_name("tx_thread")
          .set_stack_size(4096),
      multibuf_alloc
  );

  // Register RPC services
  static maco::MacoService maco_service;
  pw::System().rpc_server().RegisterService(maco_service);

  PW_LOG_INFO("=== MACO Firmware Starting ===");

  // On Particle, we use a custom StartSchedulerAndClobberTheStack from
  // particle-bazel that just loops forever (scheduler is already running).
  pw::system::StartAndClobberTheStack(channel->channel());
  PW_UNREACHABLE;
}

maco::display::DisplayDriver& GetDisplayDriver() {
  using namespace std::chrono_literals;

  // Create GPIO instances for display control
  static pb::ParticleDigitalOut rst_pin(kPinDisplayReset);
  static pb::ParticleDigitalOut cs_pin(kPinDisplayChipSelect);
  static pb::ParticleDigitalOut dc_pin(kPinDisplayDataCommand);
  static pb::ParticleDigitalOut bl_pin(kPinDisplayBacklight);

  // Configure flush thread for DMA deadlock workaround
  // See: https://community.particle.io/t/photon-2-spi-dma-transfer-deadlock-take-2/70300/5
  static const pw::thread::particle::Options flush_thread_options =
      pw::thread::particle::Options()
          .set_name("lcd_flush")
          .set_priority(3)      // Slightly above default (2)
          .set_stack_size(1536);  // Minimal - just waits and calls HAL

  // Create driver with direct HAL SPI access
  static maco::display::PicoRes28LcdDriver driver(
      HAL_SPI_INTERFACE2,  // SPI1
      kDisplaySpiClockHz,
      cs_pin,
      dc_pin,
      rst_pin,
      bl_pin,
      flush_thread_options,
      20ms  // DMA timeout
  );
  return driver;
}

maco::display::TouchButtonDriver& GetTouchButtonDriver() {
  static pb::ParticleI2cInitiator i2c(
      pb::ParticleI2cInitiator::Interface::kWire, CLOCK_SPEED_400KHZ);
  static maco::display::CapTouchInputDriver driver(i2c);
  return driver;
}

const pw::thread::Options& GetDefaultThreadOptions() {
  static const pw::thread::particle::Options options;
  return options;
}

const pw::thread::Options& GetDisplayRenderThreadOptions() {
  static const pw::thread::particle::Options options =
      pw::thread::particle::Options()
          .set_name("lvgl_render")
          .set_priority(3)
          .set_stack_size(8192);
  return options;
}

maco::nfc::NfcReader& GetNfcReader() {
  // UART buffers for PN532 (max normal frame ~262 bytes)
  // Must be 32-byte aligned for DMA on RTL872x
  constexpr size_t kUartBufferSize = 265;
  alignas(32) static std::byte rx_buf[kUartBufferSize];
  alignas(32) static std::byte tx_buf[kUartBufferSize];

  // Create async UART for PN532 communication
  static pb::AsyncUart uart(HAL_USART_SERIAL1, rx_buf, tx_buf);
  static pb::ParticleDigitalOut reset_pin(kPinNfcReset);

  // Initialize peripherals once
  static bool initialized = false;
  if (!initialized) {
    auto status = uart.Init(kNfcUartBaudRate);
    if (!status.ok()) {
      PW_LOG_ERROR("UART init failed for NFC");
    }
    status = reset_pin.Enable();
    if (!status.ok()) {
      PW_LOG_ERROR("Reset pin enable failed for NFC");
    }
    initialized = true;
  }

  static maco::nfc::Pn532NfcReader reader(
      uart, reset_pin, pw::System().allocator());
  return reader;
}

maco::config::DeviceConfig& GetDeviceConfig() {
  // Read 12-byte device ID from hardware
  static auto device_id = []() {
    uint8_t raw_id[DeviceId::kSize];
    hal_get_device_id(raw_id, sizeof(raw_id));
    return DeviceId::FromBytes(pw::ConstByteSpan(
               reinterpret_cast<const std::byte*>(raw_id), sizeof(raw_id)))
        .value();
  }();

  static maco::config::DeviceConfig config(
      pb::cloud::ParticleLedgerBackend::Instance(), device_id,
      [] { HAL_Core_System_Reset(); });

  static bool loaded = false;
  if (!loaded) {
    auto status = config.Init();
    if (!status.ok()) {
      PW_LOG_WARN("DeviceConfig not yet available");
    }
    loaded = true;
  }
  return config;
}

maco::gateway::GatewayClient& GetGatewayClient() {
  auto& dc = GetDeviceConfig();
  auto secret = GetDeviceSecrets().GetGatewayMasterSecret();
  PW_CHECK_OK(secret.status(), "Device not provisioned");
  static const auto ascon_key =
      maco::gateway::DeriveAsconKey(secret->bytes(), dc.device_id());

  static maco::gateway::GatewayConfig config{
      .host = dc.gateway_host(),
      .port = static_cast<uint16_t>(dc.gateway_port()),
      .connect_timeout_ms = 10000,
      .read_timeout_ms = 5000,
      .device_id = dc.device_id(),
      .key = ascon_key,
      .channel_id = kGatewayChannelId,
  };

  static maco::gateway::P2GatewayClient gateway_client(config);
  return gateway_client;
}

maco::firebase::FirebaseClient& GetFirebaseClient() {
  auto& gateway = GetGatewayClient();
  static maco::firebase::FirebaseClient firebase_client(
      gateway.rpc_client(), gateway.channel_id());
  return firebase_client;
}

const pw::thread::Options& GetLedThreadOptions() {
  static const pw::thread::particle::Options options =
      pw::thread::particle::Options()
          .set_name("led_render")
          .set_priority(7)     // Higher than default (5) for smooth animations
          .set_stack_size(2048);
  return options;
}

auto& GetLed() {
  // SPI interface 0 for LED strip
  static pb::ParticleSpiInitiator spi_initiator(
      pb::ParticleSpiInitiator::Interface::kSpi,
      maco::led::In4818LedDriver<16>::kSpiClockHz);
  static maco::led::In4818LedDriver<16> driver(spi_initiator);
  static maco::led::Led<maco::led::In4818LedDriver<16>> led(driver);
  return led;
}

pw::random::RandomGenerator& GetRandomGenerator() {
  static maco::HardwareRandomGenerator generator;
  return generator;
}

maco::secrets::DeviceSecretsEeprom& GetDeviceSecretsEeprom() {
  static maco::secrets::DeviceSecretsEeprom storage;
  return storage;
}

maco::secrets::DeviceSecrets& GetDeviceSecrets() {
  return GetDeviceSecretsEeprom();
}

maco::machine_relay::MachineRelay& GetMachineRelay() {
  static maco::machine_relay::LatchingMachineRelay relay(
      kPinMachineRelay, pw::async2::GetSystemTimeProvider());
  return relay;
}

maco::buzzer::Buzzer& GetBuzzer() {
  static maco::buzzer::ToneBuzzer buzzer(
      kPinBuzzer, pw::async2::GetSystemTimeProvider());
  return buzzer;
}

}  // namespace maco::system
