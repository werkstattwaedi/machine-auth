#pragma once

#include "../common.h"
#include "event/state_event.h"

namespace oww::state {

using namespace event;

namespace configuration {
constexpr auto logtag = "config";
}

constexpr auto ledger_name = "terminal-config";

class TerminalConfig {
 public:
  TerminalConfig(String machine_id, String label);
  const String machine_id;
  const String label;
};

enum class MachineControl {
  kUndefined = 0,
  kRelais0 = 1,
  kRelais1 = 2,
};

class MachineConfig {
 public:
  MachineConfig(String machine_id, MachineControl control);
  const String machine_id;
  const MachineControl control;
};

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
  Configuration(std::weak_ptr<IStateEvent> event_sink);

  Status Begin();

  bool IsConfigured() { return is_configured_; }

  TerminalConfig* GetTerminal() { return terminal_config_.get(); }

  MachineConfig* GetMachine() { return machine_config_.get(); }

  // Whether development terminal keys are used.
  bool UsesDevKeys();

  std::array<std::byte, 16> GetTerminalKey();

 private:
  std::array<std::byte, 16> terminal_key_;
  std::weak_ptr<IStateEvent> event_sink_;

  bool is_configured_ = false;
  std::unique_ptr<TerminalConfig> terminal_config_ = nullptr;
  std::unique_ptr<MachineConfig> machine_config_ = nullptr;
};

}  // namespace oww::state