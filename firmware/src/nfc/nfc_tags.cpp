#include "nfc_tags.h"

#include "common/byte_array.h"
#include "config.h"
#include "drivers/maco_watchdog.h"

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
  drivers::MacoWatchdog::instance().Ping(drivers::ObservedThread::kNfc);
  state_machine_->Loop();

  // Prevent tight loop from starving other threads.
  delay(10);
}

void NfcTags::RegisterStateHandlers() {
  state_machine_->OnLoop<WaitForTag>(
      [this](WaitForTag& state) { return OnWaitForTag(state); });
  state_machine_->OnLoop<TagPresent>(
      [this](TagPresent& state) { return OnTagPresent(state); });
  state_machine_->OnLoop<UnsupportedTag>(
      [this](UnsupportedTag& state) { return OnUnsupportedTag(state); });
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
  // Use a timeout to ensure the loop continues even when no tag is present
  // This allows the watchdog to monitor the thread's liveness
  constexpr system_tick_t kWaitForTagTimeout = 1000;  // 1 second
  auto wait_for_tag = pcd_interface_->WaitForNewTag(kWaitForTagTimeout);
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

    if (!state.selected_tag->supportsApdu) {
      // NTAG424 DNA cards are ISO14443-4 compliant.
      // Since this card is not, transition to UnsupportedTag state
      logger.info("Card does not support ISO14443-4");
      return NfcStateMachine::StateOpt(UnsupportedTag{state.selected_tag});
    }

    auto select_application_result =
        ntag_interface_->DNA_Plain_ISOSelectFile_Application();
    if (select_application_result != Ntag424::DNA_STATUS_OK) {
      logger.info("Not an NTAG424 tag (ISOSelectFile status: %d)",
                  select_application_result);
      // Not an NTAG424, transition to UnsupportedTag state
      return NfcStateMachine::StateOpt(UnsupportedTag{state.selected_tag});
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

NfcStateMachine::StateOpt NfcTags::OnUnsupportedTag(UnsupportedTag& state) {
  WITH_LOCK(*this) {
    // For non-ISO14443-4 cards, CheckTagStillAvailable won't work
    // (it uses DIAGNOSE command 0x06 which requires ISO14443-4)
    // Instead, we release the current tag and try to detect a new one with
    // a short timeout. If no tag is found, the unsupported card was removed.

    auto release_result = pcd_interface_->ReleaseTag(state.selected_tag);
    if (!release_result) {
      logger.warn("ReleaseTag failed in OnUnsupportedTag: %d",
                  (int)release_result.error());
    }

    // Try to detect a tag with a very short timeout (100ms)
    // If no tag is found, we assume the unsupported card was removed
    auto wait_result = pcd_interface_->WaitForNewTag(100);
    if (!wait_result) {
      // No tag detected - the unsupported card was removed
      return NfcStateMachine::StateOpt(WaitForTag{});
    }

    // Tag still present - stay in UnsupportedTag state
    // Update the selected_tag reference in case it changed
    state.selected_tag = wait_result.value();
  }
  delay(100);
  return std::nullopt;
}

NfcStateMachine::StateOpt NfcTags::OnNtag424Unauthenticated(
    Ntag424Unauthenticated& state) {
  WITH_LOCK(*this) {
    auto check_still_available =
        pcd_interface_->CheckTagStillAvailable(state.selected_tag);
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
    auto check_still_available =
        pcd_interface_->CheckTagStillAvailable(state.selected_tag);
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
    delay(100);
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