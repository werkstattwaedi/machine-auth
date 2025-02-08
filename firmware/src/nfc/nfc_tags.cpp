#include "nfc_tags.h"

#include "../config.h"
#include "../state/configuration.h"

using namespace config::nfc;

Logger logger(logtag);

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

  auto status = pcd_interface_->Begin();
  if (status != Status::kOk) {
    logger.error("Initialization of PN532 failed");
    return Status::kError;
  }

  os_mutex_create(&mutex_);

  thread_ = new Thread(
      "NfcTags", [this]() { NfcThread(); }, thread_priority, thread_stack_size);

  return Status::kOk;
}

os_thread_return_t NfcTags::NfcThread() {}
