#pragma once

#include "../common.h"
#include "../state/state.h"
#include "driver/Ntag424.h"
#include "driver/PN532.h"

struct NfcStateData;

// Rename to NfcWorker ?
class NfcTags {
 public:
  static NfcTags &instance();

  Status Begin(std::shared_ptr<oww::state::State> state);

 private:
  // Display is a singleton - use Display.instance()
  static NfcTags *instance_;
  NfcTags();

  virtual ~NfcTags();
  NfcTags(const NfcTags &) = delete;
  NfcTags &operator=(const NfcTags &) = delete;

  static Logger logger;
  Thread *thread_ = nullptr;
  os_mutex_t mutex_ = 0;

  os_thread_return_t NfcThread();

 private:
  std::shared_ptr<oww::state::State> state_ = nullptr;
  std::shared_ptr<PN532> pcd_interface_;
  std::shared_ptr<Ntag424> ntag_interface_;

 private:
  //  Main loop for NfcThread
  void NfcLoop(NfcStateData &data);

  void WaitForTag(NfcStateData &data);

  bool CheckTagStillAvailable(NfcStateData &data);

  void TagPerformQueuedAction(NfcStateData &data);

  void TagError(NfcStateData &data);
};
