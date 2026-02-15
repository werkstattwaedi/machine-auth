// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include "maco_firmware/apps/factory/factory_test_service.h"
#include "maco_firmware/devices/in4818/in4818_led_driver.h"
#include "maco_firmware/modules/device_secrets/device_secrets_eeprom.h"
#include "maco_firmware/modules/device_secrets/device_secrets_service.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/led/led.h"
#include "maco_firmware/modules/stack_monitor/stack_monitor.h"
#include "maco_firmware/system/system.h"
#include "pb_spi/initiator.h"
#include "pw_log/log.h"
#include "pw_system/system.h"

namespace {

// LED hardware created here so FactoryTestService can access it.
// system.cc's GetLed() uses auto& return which can't cross TU boundaries,
// so the factory app manages its own LED instance.
auto& GetFactoryLed() {
  static pb::ParticleSpiInitiator spi_initiator(
      pb::ParticleSpiInitiator::Interface::kSpi,
      maco::led::In4818LedDriver<16>::kSpiClockHz);
  static maco::led::In4818LedDriver<16> driver(spi_initiator);
  static maco::led::Led<maco::led::In4818LedDriver<16>> led(driver);
  return led;
}

void AppInit() {
  PW_LOG_INFO("MACO Factory Firmware initializing...");

  // Initialize display for visual feedback during testing
  static maco::display::Display display;
  auto status = display.Init(
      maco::system::GetDisplayDriver(),
      maco::system::GetTouchButtonDriver());
  if (!status.ok()) {
    PW_LOG_ERROR("Display init failed");
  }

  // Initialize LEDs
  auto& led = GetFactoryLed();
  status = led.Init(maco::system::GetLedThreadOptions());
  if (!status.ok()) {
    PW_LOG_ERROR("LED init failed");
  }

  // Wire LED operations for factory test service
  static constexpr maco::factory::LedOps led_ops{
      .fill = [](uint8_t r, uint8_t g, uint8_t b, uint8_t w) {
        GetFactoryLed().driver().Fill({r, g, b, w});
      },
      .set_pixel = [](uint16_t index, uint8_t r, uint8_t g, uint8_t b,
                      uint8_t w) {
        GetFactoryLed().driver().SetPixel(index, {r, g, b, w});
      },
      .clear = []() { GetFactoryLed().driver().Clear(); },
      .led_count = maco::led::In4818LedDriver<16>::kLedCount,
  };

  // Initialize buzzer
  auto& buzzer = maco::system::GetBuzzer();
  status = buzzer.Init();
  if (!status.ok()) {
    PW_LOG_ERROR("Buzzer init failed");
  }

  // Register factory-specific RPC services
  static maco::factory::FactoryTestService factory_test_service(led_ops,
                                                                buzzer);
  pw::System().rpc_server().RegisterService(factory_test_service);

  auto& secrets = static_cast<maco::secrets::DeviceSecretsEeprom&>(
      maco::system::GetDeviceSecrets());
  static maco::secrets::DeviceSecretsService device_secrets_service(secrets);
  pw::System().rpc_server().RegisterService(device_secrets_service);

  maco::StartStackMonitor();

  PW_LOG_INFO("MACO Factory Firmware ready");
}

}  // namespace

int main() {
  maco::system::Init(AppInit);
  // Init never returns
}
