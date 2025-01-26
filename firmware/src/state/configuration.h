#pragma once

#include "event/state_event.h"
#include "libbase.h"

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

 private:
  std::weak_ptr<IStateEvent> event_sink_;

  bool is_configured_ = false;
  std::unique_ptr<TerminalConfig> terminal_config_ = nullptr;
  std::unique_ptr<MachineConfig> machine_config_ = nullptr;
};

}  // namespace oww::state