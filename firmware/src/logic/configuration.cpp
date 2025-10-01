#include "configuration.h"

#include "Base64RK.h"
#include "flatbuffers/flatbuffers.h"

namespace oww::logic {

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
  auto fbs_field = data.get("fbs");
  if (!fbs_field.isString()) {
    logger.error("Ledger missing 'fbs' field with base64 data");
    return Status::kError;
  }

  String fbs_string = fbs_field.asString();
  size_t decoded_len = Base64::getMaxDecodedSize(fbs_string.length());

  config_buffer_ = std::make_unique<uint8_t[]>(decoded_len);

  if (!Base64::decode(fbs_string.c_str(), config_buffer_.get(), decoded_len)) {
    logger.error("Unparsable TerminalConfig ledger. Base64 decode failed.");
    return Status::kError;
  }

  auto verifier = flatbuffers::Verifier(config_buffer_.get(), decoded_len);

  if (!verifier.VerifyBuffer<fbs::DeviceConfig>()) {
    logger.error("Failed to parse DeviceConfig from ledger");
    return Status::kError;
  }

  device_config_ =
      flatbuffers::GetRoot<fbs::DeviceConfig>(config_buffer_.get());

  logger.info("DeviceConfig loaded: %d machine(s)",
              (int)device_config_->machines()->size());

  is_configured_ =
      device_config_ != nullptr && device_config_->machines() != nullptr;

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

}  // namespace oww::logic