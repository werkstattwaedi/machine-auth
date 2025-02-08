#include "nfc_tags.h"

#include "../config.h"
#include "../state/configuration.h"

using namespace config::nfc;

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

os_thread_return_t NfcTags::NfcThread() {
  NfcStateData state_data{.state = NfcState::kIdle};

  while (true) {
    MachineTerminalLoop(state_data);
  }
}

void NfcTags::MachineTerminalLoop(NfcStateData &data) {
  if (logger.isTraceEnabled()) {
  }
  switch (data.state) {
    case NfcState::kIdle: {
      auto wait_for_tag = pcd_interface_->WaitForTag();
      if (!wait_for_tag) return;

      auto selected_tag = wait_for_tag.value();

      data.state = NfcState::kCardFound;
      data.tg = selected_tag.tg;
    }
    case NfcState::kDeselectAndWakeup: {
    }
    case NfcState::kCardFound: {
    }
  }
}
