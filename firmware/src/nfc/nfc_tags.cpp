#include "nfc_tags.h"

#include "common/byte_array.h"
#include "config.h"

namespace oww::nfc {

using namespace config::nfc;
using namespace config::tag;

Logger NfcTags::logger("app.nfc.tags");

NfcTags* NfcTags::instance_;

NfcTags& NfcTags::instance() {
  if (!instance_) {
    instance_ = new NfcTags();
  }
  return *instance_;
}

NfcTags::NfcTags() {
  pcd_interface_ = std::make_unique<PN532>(&Serial1, config::nfc::pin_reset);
  ntag_interface_ = std::make_unique<Ntag424>(pcd_interface_.get());
  state_machine_ = NfcStateMachine::Create(std::in_place_type<WaitForTag>);
  RegisterStateHandlers();
}

NfcTags::~NfcTags() {}

NtagAction::~NtagAction() {}

Status NfcTags::Begin(std::array<uint8_t, 16> terminal_key) {
  if (thread_ != nullptr) {
    logger.error("NfcTags::Begin() Already initialized");
    return Status::kError;
  }

  terminal_key_ = terminal_key;

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
    if (!state_machine_->Is<Ntag424Authenticated>()) {
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
  logger.trace("NfcLoop");
  state_machine_->Loop();
}

void NfcTags::RegisterStateHandlers() {
  state_machine_->OnLoop<WaitForTag>(
      [this](WaitForTag& state) { return OnWaitForTag(state); });
  state_machine_->OnLoop<TagPresent>(
      [this](TagPresent& state) { return OnTagPresent(state); });
  state_machine_->OnLoop<Ntag424Unauthenticated>(
      [this](Ntag424Unauthenticated& state) {
        return OnNtag424Unauthenticated(state);
      });
  state_machine_->OnLoop<Ntag424Authenticated>(
      [this](Ntag424Authenticated& state) {
        return OnNtag424Authenticated(state);
      });
  state_machine_->OnLoop<TagError>(
      [this](TagError& state) { return OnTagError(state); });
}

NfcStateMachine::StateOpt NfcTags::OnWaitForTag(WaitForTag& state) {
  auto wait_for_tag = pcd_interface_->WaitForNewTag();
  if (!wait_for_tag) {
    return std::nullopt;
  }

  auto selected_tag = wait_for_tag.value();
  if (logger.isInfoEnabled()) {
    logger.info("Found tag with UID %s",
                ToHexString(selected_tag->nfc_id).c_str());
  }
  return NfcStateMachine::StateOpt(TagPresent{selected_tag});
}

NfcStateMachine::StateOpt NfcTags::OnTagPresent(TagPresent& state) {
  WITH_LOCK(*this) {
    ntag_interface_->SetSelectedTag(state.selected_tag);

    auto select_application_result =
        ntag_interface_->DNA_Plain_ISOSelectFile_Application();
    if (select_application_result != Ntag424::DNA_STATUS_OK) {
      logger.warn("ISOSelectFile_Application %d", select_application_result);
      // Not an NTAG424, or some other issue. We'll just stay in TagPresent.
      return std::nullopt;
    }

    auto terminal_authenticate = ntag_interface_->Authenticate(
        /* key_number = */ key_terminal, terminal_key_);

    if (terminal_authenticate.has_value()) {
      if (logger.isInfoEnabled()) {
        logger.info("Authenticated tag with terminal key");
      }

      auto card_uid = ntag_interface_->GetCardUID();
      if (!card_uid) {
        logger.error("Unable to read card UID");
        return NfcStateMachine::StateOpt(TagError{state.selected_tag});
      }

      return NfcStateMachine::StateOpt(
          Ntag424Authenticated{state.selected_tag, card_uid.value()});
    }

    if (logger.isInfoEnabled()) {
      logger.info("Authenticated tag with terminal key failed with error: %d",
                  terminal_authenticate.error());
    }

    // For unauthenticated tags, use the NFC ID from the reader
    return NfcStateMachine::StateOpt(
        Ntag424Unauthenticated{state.selected_tag, state.selected_tag->nfc_id});
  }
  return std::nullopt;
}

NfcStateMachine::StateOpt NfcTags::OnNtag424Unauthenticated(
    Ntag424Unauthenticated& state) {
  WITH_LOCK(*this) {
    auto check_still_available = pcd_interface_->CheckTagStillAvailable();
    if (!check_still_available.has_value() || !check_still_available.value()) {
      return NfcStateMachine::StateOpt(WaitForTag{});
    }
  }
  delay(100);
  return std::nullopt;
}

NfcStateMachine::StateOpt NfcTags::OnNtag424Authenticated(
    Ntag424Authenticated& state) {
  WITH_LOCK(*this) {
    auto check_still_available = pcd_interface_->CheckTagStillAvailable();
    if (!check_still_available) {
      logger.error("TagIdle::CheckTagStillAvailable returned PCD error: %d",
                   (int)check_still_available.error());
      for (auto& action : action_queue_) {
        action->OnAbort(ErrorType::kNoNfcTag);
      }
      action_queue_.clear();
      return NfcStateMachine::StateOpt(TagError{state.selected_tag});
    }

    if (!check_still_available.value()) {
      auto release_tag = pcd_interface_->ReleaseTag(state.selected_tag);
      if (!release_tag) {
        logger.warn("TagIdle::ReleaseTag returned error: %d ",
                    (int)release_tag.error());
      }
      for (auto& action : action_queue_) {
        action->OnAbort(ErrorType::kNoNfcTag);
      }
      action_queue_.clear();
      return NfcStateMachine::StateOpt(WaitForTag{});
    }

    auto it = action_queue_.begin();
    while (it != action_queue_.end()) {
      auto action = *it;
      if (action->Loop(*ntag_interface_.get()) == NtagAction::Continue) {
        return std::nullopt;
      }
      it = action_queue_.erase(it);
    }
  }
  delay(100);
  return std::nullopt;
}

NfcStateMachine::StateOpt NfcTags::OnTagError(TagError& state) {
  if (state.error_count > 3) {
    // wait for card to disappear
    return std::nullopt;
  }

  // Retry re-selecting the tag a couple times.
  state.error_count++;

  auto release_tag = pcd_interface_->ReleaseTag(state.selected_tag);
  if (release_tag) {
    return NfcStateMachine::StateOpt(WaitForTag{});
  }

  logger.warn("Release failed (%d), resetting PCD ", (int)release_tag.error());
  auto reset_controller = pcd_interface_->ResetControllerWithRetries();
  if (!reset_controller) {
    logger.error("Resetting PCD failed %d", (int)reset_controller.error());
  }
  return NfcStateMachine::StateOpt(WaitForTag{});
}
}  // namespace oww::nfc