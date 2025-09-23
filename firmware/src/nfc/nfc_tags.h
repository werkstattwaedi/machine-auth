#pragma once

#include "../common.h"
#include "../state/state.h"
#include "driver/Ntag424.h"
#include "driver/PN532.h"

struct NfcStateData;

class NtagAction {
 public:
  virtual ~NtagAction() = 0;

  enum Continuation { Done, Continue };
  virtual Continuation Loop(Ntag424 &ntag_interface) = 0;
  virtual void OnAbort(ErrorType error) = 0;
};

// Rename to NfcWorker ?
class NfcTags {
 public:
  static NfcTags &instance();

  Status Begin(std::shared_ptr<oww::state::State> state);

  // Queues an action.
  // returns an error if no tag is currently in range.
  tl::expected<void, ErrorType> QueueAction(std::shared_ptr<NtagAction> action);

  void lock() { os_mutex_lock(mutex_); };
  bool tryLock() { return os_mutex_trylock(mutex_); };
  void unlock() { os_mutex_unlock(mutex_); };

 private:
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
  std::vector<std::shared_ptr<NtagAction>> action_queue_;

 private:
  //  Main loop for NfcThread
  void NfcLoop();
  void WaitForTag();
  bool CheckTagStillAvailable();
  void TagPerformQueuedAction();
  void AbortQueuedActions();
  void TagError();

 private:
  enum class NfcState {
    kWaitForTag = 0,
    kTagIdle = 1,
    kTagUnknown = 2,
    kTagError = 3,
  };

  NfcState tag_state_ = NfcState::kWaitForTag;
  std::shared_ptr<SelectedTag> selected_tag_ = nullptr;
  int32_t error_count_ = 0;
};
