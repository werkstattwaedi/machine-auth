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
  kWaitForTag = 0,
  kTagIdle = 1,
  kTagUnknown = 2,
  kTagError = 3,

};

// NfcTags internal state machine.
// This is intentionally separate from state_ and the Pn532/Ntag424
// state
struct NfcStateData {
  NfcState state;
  std::shared_ptr<SelectedTag> selected_tag;
  std::unique_ptr<Buffer> real_uid;

  int error_count;
};

os_thread_return_t NfcTags::NfcThread() {
  NfcStateData state_data{.state = NfcState::kWaitForTag, .error_count = 0};

  while (true) {
    NfcLoop(state_data);
  }
}

void NfcTags::NfcLoop(NfcStateData &data) {
  logger.trace("NfcLoop %d", (int)data.state);
  switch (data.state) {
    case NfcState::kWaitForTag:
      WaitForTag(data);
      return;

    case NfcState::kTagIdle:
      if (!CheckTagStillAvailable(data)) return;

      TagPerformQueuedAction(data);
      return;

    case NfcState::kTagUnknown:
      CheckTagStillAvailable(data);
      return;

    case NfcState::kTagError:
      TagError(data);
      return;
  }
}

void NfcTags::WaitForTag(NfcStateData &data) {
  auto wait_for_tag = pcd_interface_->WaitForNewTag();
  if (!wait_for_tag) return;

  auto selected_tag = wait_for_tag.value();
  data.selected_tag = selected_tag;
  if (logger.isInfoEnabled()) {
    logger.info(
        "Found tag with UID %s",
        BytesToHexString(selected_tag->nfc_id, selected_tag->nfc_id_length)
            .c_str());
  }

  ntag_interface_->SetSelectedTag(selected_tag);

  state_->OnTagFound();

  auto select_application_result =
      ntag_interface_->DNA_Plain_ISOSelectFile_Application();
  if (select_application_result != Ntag424::DNA_STATUS_OK) {
    // card communication might be unstable, or the application file cannot be
    // selected.
    // FIXME - handle common errors of cards without the application.
    logger.error("ISOSelectFile_Application %d", select_application_result);
    data.state = NfcState::kTagError;
    return;
  }

  auto terminal_authenticate = ntag_interface_->Authenticate(
      /* key_number = */ key_terminal, terminal_key_bytes_);

  if (terminal_authenticate.has_value()) {
    // This tag successfully authenticated with the machine auth terminal key.
    if (logger.isInfoEnabled()) {
      logger.info("Authenticated OWW tag with terminal key");
    }

    data.state = NfcState::kTagIdle;
    state_->OnOwwTagAuthenicated();

    return;
  }

  if (logger.isInfoEnabled()) {
    logger.info("Authenticated tag with terminal key failed with error: %d",
                terminal_authenticate.error());
  }

  auto is_new_tag = ntag_interface_->IsNewTagWithFactoryDefaults();
  if (!is_new_tag.has_value()) {
    logger.error("IsNewTagWithFactoryDefaults failed %d", is_new_tag.error());
    data.state = NfcState::kTagError;
  }

  if (is_new_tag.value()) {
    state_->OnBlankNtag();
    data.state = NfcState::kTagIdle;
    return;
  }

  state_->OnUnknownTag();
  data.state = NfcState::kTagUnknown;
}

boolean NfcTags::CheckTagStillAvailable(NfcStateData &data) {
  // Poll with 10Hz
  delay(100);

  auto check_still_available = pcd_interface_->CheckTagStillAvailable();
  if (!check_still_available) {
    logger.error("TagIdle::CheckTagStillAvailable returned PCD error: %d",
                 (int)check_still_available.error());
    data.state = NfcState::kTagError;
    return false;
  }

  // Reset error count when idle; all seems good now.
  data.error_count = 0;

  if (check_still_available.value()) {
    // Nothing to do, keep polling
    return true;
  }

  auto release_tag = pcd_interface_->ReleaseTag(data.selected_tag);
  if (!release_tag) {
    logger.warn("TagIdle::ReleaseTag returned error: %d ",
                (int)release_tag.error());
  }

  data.state = NfcState::kWaitForTag;
  data.selected_tag = nullptr;
  state_->OnTagRemoved();

  return false;
}

void NfcTags::TagPerformQueuedAction(NfcStateData &data) {}

void NfcTags::TagError(NfcStateData &data) {
  if (data.error_count > 3) {
    // wait for card to disappear
    return;
  }

  auto selected_tag = data.selected_tag;

  // Retry re-selecting the tag a couple times.
  data.error_count++;
  data.state = NfcState::kWaitForTag;
  data.selected_tag = nullptr;

  auto release_tag = pcd_interface_->ReleaseTag(selected_tag);
  if (release_tag) return;

  logger.warn("Release failed (%d), resetting PCD ", (int)release_tag.error());
  auto reset_controller = pcd_interface_->ResetController();
  if (!reset_controller) {
    logger.error("Resetting PCD failed %d", (int)reset_controller.error());
  }
}

// void NfcTags::NfcLoop(NfcStateData &data) {
//   switch (data.state) {
//     case NfcState::kWaitForTag: {
//       return;
//     }
//     case NfcState::kCardFound: {
//       auto auth_result = ntag_interface_->Authenticate(
//           /* key_number = */ key_terminal, terminal_key_bytes_);

//       if (auth_result) {
//         // This tag successfully authenticated with the machine auth terminal
//         // key.
//         logger.trace("OWW tag found");

//         data.state = NfcState::kTerminalAuthenticated;

//       } else {
//         logger.trace("AUTH failed %d", auth_result.error());

//         delay(500);
//         logger.trace("Trying key 0");

//         byte key_number = 0;
//         std::array<byte, 16> authKey = {};  // all zeros on delivery

//         auto result = ntag_interface_->Authenticate(key_number, authKey);
//         if (!result) {
//           logger.error("Failed to authenticate key 0 %d", result.error());
//           return;
//         }

//         logger.trace("Auth key 0");

//         delay(5000);

//         auto is_new_tag_response =
//             ntag_interface_->DNA_Plain_IsNewTag_WithFactoryDefaults();
//         if (!is_new_tag_response) {
//           logger.error("IsNewTag failed %d", is_new_tag_response.error());
//           data.state = NfcState::kTagError;
//         }

//         // if (is_new_tag_response.value()) {
//         //   data.state = NfcState::kNewTag;
//         //   return;
//         // }

//         uint8_t response_data[29];
//         uint8_t response_length = 29;
//         auto get_version_result = ntag_interface_->DNA_Plain_GetVersion(
//             response_data, &response_length);
//         if (get_version_result != Ntag424::DNA_STATUS_OK) {
//           logger.error("Get Version Failed %d", get_version_result);
//           data.state = NfcState::kTagError;
//           return;
//         }

//         logger.info("Version Info: " +
//                     BytesToHexAndAsciiString(response_data,
//                     response_length));
//       }

//       data.state = NfcState::kCardInRange;

//       return;
//     }

//     case NfcState::kNewTag: {
//       byte key_number = 0;
//       std::array<byte, 16> authKey = {};  // all zeros on delivery

//       auto result = ntag_interface_->Authenticate(key_number, authKey);
//       if (!result) {
//         logger.error("Failed to authenticate key 0 %d", result.error());
//         return;
//       }

//       byte oldKey[16] = {};  // all zeros on delivery
//       byte newKeyVersion = 1;
//       auto dna_statusCode = ntag_interface_->DNA_Full_ChangeKey(
//           key_terminal, oldKey, terminal_key_bytes_.data(), newKeyVersion);
//       if (dna_statusCode != Ntag424::DNA_STATUS_OK) {
//         logger.error("Failed to change key 1 %d", dna_statusCode);
//         return;
//       }

//       logger.info("Key 1 changed sucessfully");

//       byte newKey[16] = {
//           0x87, 0x50, 0x25, 0x1e, 0xe1, 0x73, 0xa3, 0x26,
//           0x2d, 0xa3, 0x6e, 0x88, 0x4a, 0xd2, 0x44, 0x02,
//       };  // all zeros on delivery

//       dna_statusCode = ntag_interface_->DNA_Full_ChangeKey(
//           key_authorization, oldKey, newKey, newKeyVersion);
//       if (dna_statusCode != Ntag424::DNA_STATUS_OK) {
//         logger.error("Failed to change key 2 %d", dna_statusCode);
//         return;
//       }

//       logger.info("Key 2 changed sucessfully");

//       auto release_tag = pcd_interface_->ReleaseTag(data.selected_tag);
//       if (release_tag) {
//         data.state = NfcState::kWaitForTag;
//         data.selected_tag = nullptr;
//         return;
//       };

//       return;
//     }
//     case NfcState::kTagError: {
//       auto release_tag = pcd_interface_->ReleaseTag(data.selected_tag);
//       if (release_tag) {
//         data.state = NfcState::kWaitForTag;
//         data.selected_tag = nullptr;
//         return;
//       };

//       logger.warn("Release failed (%d), resetting PCD ",
//                   (int)release_tag.error());

//       pcd_interface_->ResetController();

//       data.state = NfcState::kWaitForTag;
//       data.selected_tag = nullptr;

//       return;
//     }
//     case NfcState::kTerminalAuthenticated: {
//      
//     }
//     case NfcState::kCloudAuthRequested: {
//       // TODO() wait for cloud resposne
//     }
//   }
// }
