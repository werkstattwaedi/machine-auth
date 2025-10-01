#pragma once

#include "common.h"
#include "fbs/ledger_terminal-config_generated.h"

namespace oww::logic {

constexpr auto ledger_name = "terminal-config";

// Sensitive data stored in EEPROM in "factory", that is when assembling and
// getting devices ready. Data in EEPROM is not meant to be seen in the particle
// cloud, only in a secure environment where devices are assembled.
//
// Production devices use the device protection feature to avoid attackers
// flashing their own firmware and extract the keys.
// https://docs.particle.io/scaling/enterprise-features/device-protection/
//
struct FactoryData {
  uint8_t version;
  byte key[16];
  boolean setup_complete;
};

/**
 * Terminal / machine based config, based on device ledger.
 *
 * The configuration is considered immutable. Once the ledger has been updated,
 * OnConfigChanged is dispatched and is expected to restart the device to catch
 * up with the newest config.
 */
class Configuration {
 public:
  Configuration();

  Status Begin();

  bool IsConfigured() { return is_configured_; }

  bool IsSetupMode();

  const fbs::DeviceConfig* GetDeviceConfig() { return device_config_; }

  // Whether development terminal keys are used.
  bool UsesDevKeys();

  std::array<uint8_t, 16> GetTerminalKey();

 private:
  // Particle function handler for setSetupMode
  int SetSetupModeHandler(String command);
  
  std::array<uint8_t, 16> terminal_key_;
  bool is_configured_ = false;
  bool is_setup_mode_ = false;
  
  const fbs::DeviceConfig* device_config_ = nullptr;
  std::unique_ptr<uint8_t[]> config_buffer_;

  void OnConfigChanged();
};

}  // namespace oww::logic