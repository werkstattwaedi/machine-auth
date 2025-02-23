#include "nfc_tags.h"

#include "../config.h"
#include "../state/configuration.h"

using namespace config::nfc;
using namespace config::tag;

Logger NfcTags::logger(logtag);

NfcTags *NfcTags::instance_;

NfcTags &NfcTags::instance() {
  if (!instance_) {
    instance_ = new NfcTags();
  }
  return *instance_;
}

NfcTags::NfcTags() {
  pcd_interface_ = std::make_unique<PN532>(&Serial1, config::nfc::pin_reset,
                                           config::nfc::pin_reset);
  ntag_interface_ = std::make_unique<Ntag424>(pcd_interface_.get());
}

NfcTags::~NfcTags() {}

Status NfcTags::Begin(std::shared_ptr<oww::state::State> state) {
  if (thread_ != nullptr) {
    logger.error("NfcTags::Begin() Already initialized");
    return Status::kError;
  }

  state_ = state;

  auto pcd_begin = pcd_interface_->Begin();
  if (!pcd_begin) {
    logger.error("Initialization of PN532 failed");
    return Status::kError;
  }

  os_mutex_create(&mutex_);

  thread_ = new Thread(
      "NfcTags", [this]() { NfcThread(); }, thread_priority, thread_stack_size);

  return Status::kOk;
}

enum class NfcState {
  kIdle = 0,
  kCardFound = 1,
  kCardInRange = 2,
  kDeselectAndWakeup = 3,
  kCardError = 4,
  kNewTag = 5,

  kTerminalAuthenticated = 6,
  kCloudAuthRequested = 7,

};

// NfcTags internal state machine.
// This is intentionally separate from state_ and the Pn532/Ntag424
// state
struct NfcStateData {
  NfcState state;
  std::shared_ptr<SelectedTag> selected_tag;
  std::unique_ptr<Buffer> real_uid;
};

os_thread_return_t NfcTags::NfcThread() {
  NfcStateData state_data{.state = NfcState::kIdle};

  while (true) {
    MachineTerminalLoop(state_data);
  }
}

void NfcTags::MachineTerminalLoop(NfcStateData &data) {
  logger.trace("MachineTerminalLoop %d", (int)data.state);
  switch (data.state) {
    case NfcState::kIdle: {
      auto wait_for_tag = pcd_interface_->WaitForNewTag();
      if (!wait_for_tag) return;

      auto selected_tag = wait_for_tag.value();
      logger.info("Found tag ID");
      ntag_interface_->SetSelectedTag(selected_tag);

      data.state = NfcState::kCardFound;
      data.selected_tag = selected_tag;

      state_->OnTagFound();

      return;
    }
    case NfcState::kCardFound: {
      auto select_application_result =
          ntag_interface_->DNA_Plain_ISOSelectFile_Application();
      if (select_application_result != Ntag424::DNA_STATUS_OK) {
        logger.error("ISOSelectFile_Application %d", select_application_result);
        data.state = NfcState::kCardError;
        return;
      }

      auto auth_result = ntag_interface_->Authenticate(
          /* key_number = */ key_terminal, terminal_key_bytes_);

      if (auth_result) {
        // This tag successfully authenticated with the machine auth terminal
        // key.
        logger.trace("OWW tag found");

        data.state = NfcState::kTerminalAuthenticated;

      } else {

        logger.trace("AUTH failed %d", auth_result.error());

        delay (500);
        logger.trace("Trying key 0");

        byte key_number = 0;
        std::array<byte, 16> authKey = {};  // all zeros on delivery
  
        auto result = ntag_interface_->Authenticate(key_number, authKey);
        if (!result) {
          logger.error("Failed to authenticate key 0 %d", result.error());
          return;
        }

        logger.trace("Auth key 0");


        delay (5000);



        auto is_new_tag_response =
            ntag_interface_->DNA_Plain_IsNewTag_WithFactoryDefaults();
        if (!is_new_tag_response) {
          logger.error("IsNewTag failed %d", is_new_tag_response.error());
          data.state = NfcState::kCardError;
        }

        // if (is_new_tag_response.value()) {
        //   data.state = NfcState::kNewTag;
        //   return;
        // }

        uint8_t response_data[29];
        uint8_t response_length = 29;
        auto get_version_result = ntag_interface_->DNA_Plain_GetVersion(
            response_data, &response_length);
        if (get_version_result != Ntag424::DNA_STATUS_OK) {
          logger.error("Get Version Failed %d", get_version_result);
          data.state = NfcState::kCardError;
          return;
        }

        logger.info("Version Info: " +
                    BytesToHexAndAsciiString(response_data, response_length));
      }

      data.state = NfcState::kCardInRange;

      return;
    }

    case NfcState::kCardInRange: {
      logger.info("Pinging");
      auto ping_result = ntag_interface_->DNA_Plain_Ping();

      if (ping_result != Ntag424::DNA_STATUS_OK) {
        logger.info("Removed %d", ping_result);
        state_->OnTagRemoved();

        data.state = NfcState::kCardError;
        return;
      }

      // Polling card every 500ms
      delay(500);
      return;
    }

    case NfcState::kDeselectAndWakeup: {
      return;
    }

    case NfcState::kNewTag: {
      byte key_number = 0;
      std::array<byte, 16> authKey = {};  // all zeros on delivery

      auto result = ntag_interface_->Authenticate(key_number, authKey);
      if (!result) {
        logger.error("Failed to authenticate key 0 %d", result.error());
        return;
      }

      byte oldKey[16] = {};  // all zeros on delivery
      byte newKeyVersion = 1;
      auto dna_statusCode = ntag_interface_->DNA_Full_ChangeKey(
          key_terminal, oldKey, terminal_key_bytes_.data(), newKeyVersion);
      if (dna_statusCode != Ntag424::DNA_STATUS_OK) {
        logger.error("Failed to change key 1 %d", dna_statusCode);
        return;
      }

      logger.info("Key 1 changed sucessfully");

      byte newKey[16] = {
          0x87, 0x50, 0x25, 0x1e, 0xe1, 0x73, 0xa3, 0x26,
          0x2d, 0xa3, 0x6e, 0x88, 0x4a, 0xd2, 0x44, 0x02,
      };  // all zeros on delivery

      dna_statusCode = ntag_interface_->DNA_Full_ChangeKey(
          key_authorization, oldKey, newKey, newKeyVersion);
      if (dna_statusCode != Ntag424::DNA_STATUS_OK) {
        logger.error("Failed to change key 2 %d", dna_statusCode);
        return;
      }

      logger.info("Key 2 changed sucessfully");

      auto release_tag = pcd_interface_->ReleaseTag(data.selected_tag);
      if (release_tag) {
        data.state = NfcState::kIdle;
        data.selected_tag = nullptr;
        return;
      };

      return;
    }
    case NfcState::kCardError: {
      auto release_tag = pcd_interface_->ReleaseTag(data.selected_tag);
      if (release_tag) {
        data.state = NfcState::kIdle;
        data.selected_tag = nullptr;
        return;
      };

      logger.warn("Release failed (%d), resetting PCD ",
                  (int)release_tag.error());

      pcd_interface_->ResetController();

      data.state = NfcState::kIdle;
      data.selected_tag = nullptr;

      return;
    }
    case NfcState::kTerminalAuthenticated: {
      auto card_uid_result = ntag_interface_->GetCardUID();
      if (!card_uid_result) {
        logger.error("GetCardUID failed %d", card_uid_result.error());
        data.state = NfcState::kCardError;
        return;
      }

      data.real_uid = std::move(card_uid_result.value());

      auto authentication_begin_result =
          ntag_interface_->AuthenticateWithCloud_Begin(key_authorization);
      if (!authentication_begin_result) {
        logger.error("AuthenticateWithCloud_Begin failed %d",
                     authentication_begin_result.error());
        data.state = NfcState::kCardError;
        return;
      }

      Variant payload;
      payload.set("uid", Variant(data.real_uid->toHex()));
      payload.set("challenge",
                  Variant(authentication_begin_result.value()->toHex()));
      Particle.publish("terminal-authentication", payload);
      data.state = NfcState::kCloudAuthRequested;
      return;
    }
    case NfcState::kCloudAuthRequested: {
      // TODO() wait for cloud resposne
    }
  }
}
