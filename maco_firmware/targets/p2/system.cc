// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/system/system.h"

#include <cstddef>

// Pigweed headers first - before Particle headers that define pin macros
// (D2, D3, etc.) which conflict with Pigweed template parameter names.
#include "pw_assert/check.h"
#include "pw_channel/stream_channel.h"
#include "pw_log/log.h"
#include "pw_multibuf/simple_allocator.h"
#include "pw_system/io.h"
#include "pw_system/system.h"
#include "pw_thread_particle/options.h"

// Particle and project headers after Pigweed
#include "maco_firmware/services/maco_service.h"
#include "maco_firmware/devices/cap_touch/cap_touch_input_driver.h"
#include "maco_firmware/devices/in4818/in4818_led_driver.h"
#include "maco_firmware/devices/pico_res28_lcd/pico_res28_lcd_driver.h"
#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"
#include "maco_firmware/modules/led/led.h"
#include "maco_firmware/modules/app_state/app_state.h"
#include "maco_firmware/modules/gateway/p2_gateway_client.h"
#include "maco_firmware/targets/p2/hardware_random.h"
#include "firebase/firebase_client.h"
#include "pb_crypto/pb_crypto.h"
#include "pb_digital_io/digital_io.h"
#include "pb_stream/uart_stream.h"
#include "pb_log/log_bridge.h"
#include "pb_spi/initiator.h"
#include "pinmap_hal.h"
#include "delay_hal.h"
#include "usb_hal.h"

namespace maco::system {

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

  // Larger buffer for tokenized logging - must handle log backpressure
  // when console isn't connected or draining slowly.
  static std::byte channel_buffer[16384];
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
  // Create GPIO instances for display control
  static pb::ParticleDigitalOut rst_pin(kPinDisplayReset);
  static pb::ParticleDigitalOut cs_pin(kPinDisplayChipSelect);
  static pb::ParticleDigitalOut dc_pin(kPinDisplayDataCommand);
  static pb::ParticleDigitalOut bl_pin(kPinDisplayBacklight);

  // Create SPI initiator for display (using SPI1 = HAL_SPI_INTERFACE2)
  static pb::ParticleSpiInitiator spi_initiator(
      pb::ParticleSpiInitiator::Interface::kSpi1,
      kDisplaySpiClockHz);

  // Create and return driver with injected dependencies
  static maco::display::PicoRes28LcdDriver driver(
      spi_initiator, cs_pin, dc_pin, rst_pin, bl_pin);
  return driver;
}

maco::display::TouchButtonDriver& GetTouchButtonDriver() {
  static maco::display::CapTouchInputDriver driver;
  return driver;
}

const pw::thread::Options& GetDefaultThreadOptions() {
  static const pw::thread::particle::Options options;
  return options;
}

maco::nfc::NfcReader& GetNfcReader() {
  // Create UART stream for PN532 communication
  static pb::ParticleUartStream uart(HAL_USART_SERIAL1);
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

  static maco::nfc::Pn532NfcReader reader(uart, reset_pin);
  return reader;
}

maco::app_state::AppState& GetAppState() {
  static maco::app_state::AppState state;
  return state;
}

maco::gateway::GatewayClient& GetGatewayClient() {
  // Master secret for key derivation
  // TODO: This should be provisioned securely during device setup
  static constexpr std::array<std::byte, 16> kMasterSecret = {
      std::byte{0x00}, std::byte{0x01}, std::byte{0x02}, std::byte{0x03},
      std::byte{0x04}, std::byte{0x05}, std::byte{0x06}, std::byte{0x07},
      std::byte{0x08}, std::byte{0x09}, std::byte{0x0A}, std::byte{0x0B},
      std::byte{0x0C}, std::byte{0x0D}, std::byte{0x0E}, std::byte{0x0F},
  };

  // Device ID - TODO: Get from Particle device ID
  static constexpr uint64_t kDeviceId = 0x0001020304050607ULL;

  // Derive per-device ASCON key: key = ASCON-Hash(master_secret || device_id)
  static auto derive_key = []() {
    std::array<std::byte, 24> key_material;  // 16 + 8 bytes
    std::copy(kMasterSecret.begin(), kMasterSecret.end(), key_material.begin());

    // Append device ID in big-endian
    for (int i = 7; i >= 0; --i) {
      key_material[16 + (7 - i)] =
          static_cast<std::byte>((kDeviceId >> (i * 8)) & 0xFF);
    }

    std::array<std::byte, pb::crypto::kAsconHashSize> hash;
    auto status = pb::crypto::AsconHash256(key_material, hash);
    PW_CHECK_OK(status, "Key derivation failed");

    // Use first 16 bytes of hash as ASCON key
    std::array<std::byte, pb::crypto::kAsconKeySize> key;
    std::copy(hash.begin(), hash.begin() + key.size(), key.begin());
    return key;
  };
  static const auto ascon_key = derive_key();

  // Gateway configuration
  // TODO: Read host/port from Particle device ledger configuration
  static maco::gateway::GatewayConfig config{
      .host = "192.168.1.100",
      .port = 5000,
      .connect_timeout_ms = 10000,
      .read_timeout_ms = 5000,
      .device_id = kDeviceId,
      .key = ascon_key.data(),
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

}  // namespace maco::system
