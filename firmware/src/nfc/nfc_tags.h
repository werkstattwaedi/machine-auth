#pragma once

#include "../common.h"
#include "common/state_machine.h"
#include "driver/Ntag424.h"
#include "driver/PN532.h"
#include "nfc/states.h"
#include "state/configuration.h"

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
  using NfcStateMachine =
      oww::common::StateMachine<oww::nfc::WaitForTag, oww::nfc::TagPresent,
                                oww::nfc::Ntag424Unauthenticated,
                                oww::nfc::Ntag424Authenticated,
                                oww::nfc::TagError>;

  static NfcTags &instance();

  Status Begin(std::array<uint8_t, 16> terminal_key);

  // Queues an action.
  // returns an error if no tag is currently in range.
  tl::expected<void, ErrorType> QueueAction(std::shared_ptr<NtagAction> action);

  void lock() { os_mutex_lock(mutex_); };
  bool tryLock() { return os_mutex_trylock(mutex_); };
  void unlock() { os_mutex_unlock(mutex_); };

  std::shared_ptr<NfcStateMachine> GetStateMachine() { return state_machine_; }

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
  // Main loop for NfcThread
  void NfcLoop();

  void RegisterStateHandlers();

  // State machine handlers
  NfcStateMachine::StateOpt OnWaitForTag(oww::nfc::WaitForTag &state);
  NfcStateMachine::StateOpt OnTagPresent(oww::nfc::TagPresent &state);
  NfcStateMachine::StateOpt OnNtag424Unauthenticated(
      oww::nfc::Ntag424Unauthenticated &state);
  NfcStateMachine::StateOpt OnNtag424Authenticated(
      oww::nfc::Ntag424Authenticated &state);
  NfcStateMachine::StateOpt OnTagError(oww::nfc::TagError &state);

 private:
  std::array<uint8_t, 16> terminal_key_;
  std::shared_ptr<PN532> pcd_interface_;
  std::shared_ptr<Ntag424> ntag_interface_;
  std::vector<std::shared_ptr<NtagAction>> action_queue_;
  std::shared_ptr<NfcStateMachine> state_machine_;
};

static const NfcTags::NfcStateMachine::Query HasTag([](const auto &state) {
  return !std::holds_alternative<oww::nfc::WaitForTag>(state);
});
