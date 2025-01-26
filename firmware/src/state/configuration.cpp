

#include "configuration.h"
namespace oww::state {

Logger logger(configuration::logtag);

TerminalConfig::TerminalConfig(String machine_id, String label)
    : machine_id(machine_id), label(label) {}
MachineConfig::MachineConfig(String machine_id, MachineControl control)
    : machine_id(machine_id), control(control) {}

Configuration::Configuration(std::weak_ptr<IStateEvent> event_sink)
    : event_sink_(event_sink) {}

Status Configuration::Begin() {
  auto ledger = Particle.ledger(ledger_name);

  ledger.onSync(
      [this](Ledger ledger) { event_sink_.lock()->OnConfigChanged(); });

  if (!ledger.isValid()) {
    logger.warn("Ledger is not valid, waiting for sync.");
    return Status::kOk;
  }

  auto data = ledger.get();
  auto terminal_data = data.get("terminal");
  if (terminal_data.isMap()) {
    auto machine_id = terminal_data.get("machineId");
    if (!machine_id.isString()) {
      logger.error("terminal configuration is missing [machineId]");
      return Status::kError;
    }

    auto machine_name = terminal_data.get("machineName");
    if (!machine_name.isString()) {
      logger.error("terminal configuration is missing [machineName]");
      return Status::kError;
    }

    terminal_config_ = std::make_unique<TerminalConfig>(
        machine_id.asString(), machine_name.asString());
  }

  auto machine_list = data.get("machine");
  if (machine_list.isArray() && machine_list.asArray().size() == 1) {
    auto machine_data = machine_list.asArray().first();

    auto machine_id = machine_data.get("machineId");
    if (!machine_id.isString()) {
      logger.error("machine configuration is missing [machineId]");
      return Status::kError;
    }

    auto control_string = machine_data.get("control");
    if (!control_string.isString()) {
      logger.error("machine configuration is missing [control]");
      return Status::kError;
    }

    MachineControl control = MachineControl::kUndefined;
    if (control_string.asString() == "relais-0") {
      control = MachineControl::kRelais0;
    } else {
      logger.error("machine configuration unknown control [%s]",
                   control_string.asString().c_str());
      return Status::kError;
    }

    machine_config_ =
        std::make_unique<MachineConfig>(machine_id.asString(), control);
  }

  is_configured_ = true;

  return Status::kOk;
}

}  // namespace oww::state