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
  pcd_interface_ = std::make_unique<PN532>(&Serial1, config::nfc::pin_reset);
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

tl::expected<void, ErrorType> NfcTags::QueueAction(
    std::shared_ptr<NtagAction> action) {
  WITH_LOCK(*this) {
    if (tag_state_ != NfcState::kTagIdle) {
      return tl::unexpected(ErrorType::kNoNfcTag);
    }

    action_queue_.push_back(action);
  }
  return {};
}

os_thread_return_t NfcTags::NfcThread() {
  while (true) {
    NfcLoop();
  }
}

void NfcTags::NfcLoop() {
  logger.trace("NfcLoop %d", (int)tag_state_);
  switch (tag_state_) {
    case NfcState::kWaitForTag:
      WaitForTag();
      return;

    case NfcState::kTagIdle:
      WITH_LOCK(*this) {
        if (!CheckTagStillAvailable()) {
          AbortQueuedActions();
          return;
        }

        TagPerformQueuedAction();
      }
      delay(100);
      return;

    case NfcState::kTagUnknown:
      WITH_LOCK(*this) { CheckTagStillAvailable(); }
      // Rate limit
      delay(100);
      return;

    case NfcState::kTagError:
      WITH_LOCK(*this) { TagError(); }
      return;
  }
}

void NfcTags::WaitForTag() {
  auto wait_for_tag = pcd_interface_->WaitForNewTag();
  if (!wait_for_tag) return;

  WITH_LOCK(*this) {
    selected_tag_ = wait_for_tag.value();
    if (logger.isInfoEnabled()) {
      logger.info("Found tag with UID %s",
                  ToHexString(selected_tag_->nfc_id).c_str());
    }

    ntag_interface_->SetSelectedTag(selected_tag_);

    state_->OnTagFound();

    auto select_application_result =
        ntag_interface_->DNA_Plain_ISOSelectFile_Application();
    if (select_application_result != Ntag424::DNA_STATUS_OK) {
      // card communication might be unstable, or the application file cannot be
      // selected.
      // FIXME - handle common errors of cards without the application.
      logger.error("ISOSelectFile_Application %d", select_application_result);
      tag_state_ = NfcState::kTagError;
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
        tag_state_ = NfcState::kTagError;
        return;
      }

      tag_state_ = NfcState::kTagIdle;
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
      tag_state_ = NfcState::kTagError;
    }

    if (is_new_tag.value() && selected_tag_->nfc_id_length == 7) {
      state_->OnBlankNtag(selected_tag_->nfc_id);
      tag_state_ = NfcState::kTagIdle;
      return;
    }

    state_->OnUnknownTag();
    tag_state_ = NfcState::kTagUnknown;
  }
}

boolean NfcTags::CheckTagStillAvailable() {
  auto check_still_available = pcd_interface_->CheckTagStillAvailable();
  if (!check_still_available) {
    logger.error("TagIdle::CheckTagStillAvailable returned PCD error: %d",
                 (int)check_still_available.error());
    tag_state_ = NfcState::kTagError;
    return false;
  }

  // Reset error count when idle; all seems good now.
  error_count_ = 0;

  if (check_still_available.value()) {
    // Nothing to do, keep polling
    return true;
  }

  auto release_tag = pcd_interface_->ReleaseTag(selected_tag_);
  if (!release_tag) {
    logger.warn("TagIdle::ReleaseTag returned error: %d ",
                (int)release_tag.error());
  }

  tag_state_ = NfcState::kWaitForTag;
  selected_tag_ = nullptr;
  state_->OnTagRemoved();

  return false;
}

void NfcTags::TagPerformQueuedAction() {
  auto it = action_queue_.begin();
  while (it != action_queue_.end()) {
    auto action = *it;
    if (action->Loop(*ntag_interface_.get()) == NtagAction::Continue) {
      return;
    }

    it = action_queue_.erase(it);
  }
}

void NfcTags::AbortQueuedActions() {
  for (auto &action : action_queue_) {
    action->OnAbort(ErrorType::kNoNfcTag);
  }
  action_queue_.clear();
}

void NfcTags::TagError() {
  if (error_count_ > 3) {
    // wait for card to disappear
    return;
  }

  auto selected_tag = selected_tag_;

  // Retry re-selecting the tag a couple times.
  error_count_++;
  tag_state_ = NfcState::kWaitForTag;
  selected_tag_ = nullptr;

  auto release_tag = pcd_interface_->ReleaseTag(selected_tag);
  if (release_tag) return;

  logger.warn("Release failed (%d), resetting PCD ", (int)release_tag.error());
  auto reset_controller = pcd_interface_->ResetControllerWithRetries();
  if (!reset_controller) {
    logger.error("Resetting PCD failed %d", (int)reset_controller.error());
  }
}
