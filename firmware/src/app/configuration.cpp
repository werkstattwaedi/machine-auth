

#include "configuration.h"
namespace oww::app {

// Factory data used for dev devices.
FactoryData DEV_FACTORY_DATA{
    .version = 2,
    .key =
        {
            // THIS KEY IS FOR DEVELOPMENT PURPOSES ONLY. DO NOT USE IN
            // PRODUCTION.
            0xf5,
            0xe4,
            0xb9,
            0x99,
            0xd5,
            0xaa,
            0x62,
            0x9f,
            0x19,
            0x3a,
            0x87,
            0x45,
            0x29,
            0xc4,
            0xaa,
            0x2f,
        },
    .setup_complete = false,
};

Logger logger("config");

TerminalConfig::TerminalConfig(String machine_id, String label)
    : machine_id(machine_id), label(label) {}
MachineConfig::MachineConfig(String machine_id, MachineControl control)
    : machine_id(machine_id), control(control) {}

Configuration::Configuration() {
  // Register Particle function with member function
  Particle.function("setSetupMode", &Configuration::SetSetupModeHandler, this);
}

Status Configuration::Begin() {
  auto factory_data = std::make_unique<FactoryData>();

  EEPROM.get(0, *(factory_data.get()));
  if (factory_data->version == 1) {
    logger.warn("FactoryData EEPROM is outdated, updating to version 2");
    factory_data->version = 2;
    factory_data->setup_complete = false;
    EEPROM.put(0, *(factory_data.get()));
  } else if (factory_data->version == 0xFF) {
    logger.warn("FactoryData EEPROM is invalid. Flashing DEV_FACTORY_DATA");
    // This device never saw factory data before. Write the dev data.
    // TODO(michschn) fail on production devices instead.
    EEPROM.put(0, DEV_FACTORY_DATA);
    memcpy(factory_data.get(), &DEV_FACTORY_DATA, sizeof(FactoryData));
  }

  is_setup_mode_ = !factory_data->setup_complete;

  memcpy(terminal_key_.data(), factory_data->key, 16);

  if (UsesDevKeys()) {
    logger.warn(
        "Dev keys are in use. Production devices must be provisioned with "
        "production keys.");
  }

  auto ledger = Particle.ledger(ledger_name);

  ledger.onSync([this](Ledger ledger) { OnConfigChanged(); });

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

  is_configured_ = terminal_config_ != nullptr;

  return Status::kOk;
}

bool Configuration::IsSetupMode() {
  auto factory_data = std::make_unique<FactoryData>();
  EEPROM.get(0, *(factory_data.get()));
  return !factory_data->setup_complete;
}

bool Configuration::UsesDevKeys() {
  return memcmp(terminal_key_.begin(), DEV_FACTORY_DATA.key, 16) == 0;
}

std::array<uint8_t, 16> Configuration::GetTerminalKey() {
  return terminal_key_;
}

int Configuration::SetSetupModeHandler(String command) {
  // Parse boolean from command string
  command.trim();
  command.toLowerCase();

  bool setup_mode;
  if (command == "true") {
    setup_mode = true;
  } else if (command == "false") {
    setup_mode = false;
  } else {
    return -2;  // Invalid command format
  }

  // Check if the setup mode needs to be changed
  if (is_setup_mode_ == setup_mode) {
    // No change needed
    logger.info("Setup mode unchanged (setup_mode=%s)",
                setup_mode ? "true" : "false");
    return 0;
  }

  // Read current factory data
  auto factory_data = std::make_unique<FactoryData>();
  EEPROM.get(0, *(factory_data.get()));

  // Update the factory data
  factory_data->setup_complete = !setup_mode;
  EEPROM.put(0, *(factory_data.get()));

  // Notify about config change which will trigger restart
  OnConfigChanged();

  return 0;
}

void Configuration::OnConfigChanged() {
  System.reset(RESET_REASON_CONFIG_UPDATE);
}

}  // namespace oww::app