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
#include "maco_firmware/devices/pico_res28_lcd/pico_res28_lcd_driver.h"
#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"
#include "maco_firmware/modules/app_state/app_state.h"
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

}  // namespace maco::system
