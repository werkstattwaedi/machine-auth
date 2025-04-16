#include "nfc_tags.h"

#include "../config.h"
#include "../state/configuration.h"
#include "common/byte_array.h"

using namespace config::nfc;
using namespace config::tag;

Logger NfcTags::logger("nfc");

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
    logger.info("Found tag with UID %s",
                ToHexString(selected_tag->nfc_id).c_str());
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
      /* key_number = */ key_terminal,
      state_->GetConfiguration()->GetTerminalKey());

  if (terminal_authenticate.has_value()) {
    // This tag successfully authenticated with the machine auth terminal key.
    if (logger.isInfoEnabled()) {
      logger.info("Authenticated tag with terminal key");
    }

    auto card_uid = ntag_interface_->GetCardUID();
    if (!card_uid) {
      logger.error("Unable to read card UID");
      data.state = NfcState::kTagError;
      return;
    }

    data.state = NfcState::kTagIdle;
    state_->OnTagAuthenicated(card_uid.value());

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

  if (is_new_tag.value() && selected_tag->nfc_id_length == 7) {
    state_->OnBlankNtag(selected_tag->nfc_id);
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

void NfcTags::TagPerformQueuedAction(NfcStateData &data) {
  using namespace oww::state;
  auto tag_state = state_->GetTagState();
  if (auto state = std::get_if<tag::Authorize>(tag_state.get())) {
    if (auto new_state = tag::NfcLoop(*state, *ntag_interface_.get())) {
      state_->OnNewState(new_state.value());
    }
  } else if (auto state = std::get_if<tag::Personalize>(tag_state.get())) {
    if (auto new_state = tag::NfcLoop(*state, *ntag_interface_.get())) {
      state_->OnNewState(new_state.value());
    }
  }
}

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
