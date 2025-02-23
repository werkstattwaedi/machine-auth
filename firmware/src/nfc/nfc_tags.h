#pragma once

#include "../common.h"
#include "../state/state.h"
#include "driver/Ntag424.h"
#include "driver/PN532.h"

struct NfcStateData;
class NfcTags {
 public:
  static NfcTags &instance();

  Status Begin(std::shared_ptr<oww::state::State> state);
  /**
   * @brief Locks the mutex that protects shared resources
   *
   * This is compatible with `WITH_LOCK(*this)`.
   *
   * The mutex is not recursive so do not lock it within a locked section.
   */
  void lock() { os_mutex_lock(mutex_); };

  /**
   * @brief Attempts to lock the mutex that protects shared resources
   *
   * @return true if the mutex was locked or false if it was busy already.
   */
  bool tryLock() { return os_mutex_trylock(mutex_); };

  /**
   * @brief Unlocks the mutex that protects shared resources
   */
  void unlock() { os_mutex_unlock(mutex_); };

 private:
  // Display is a singleton - use Display.instance()
  static NfcTags *instance_;
  NfcTags(
      // std::unique_ptr<PN532> pcd_interface,
      // std::unique_ptr<Ntag424> ntag_interface
  );

  virtual ~NfcTags();
  NfcTags(const NfcTags &) = delete;
  NfcTags &operator=(const NfcTags &) = delete;

  static Logger logger;
  Thread *thread_ = nullptr;
  os_mutex_t mutex_ = 0;

  std::shared_ptr<oww::state::State> state_ = nullptr;

  std::unique_ptr<PN532> pcd_interface_;
  std::unique_ptr<Ntag424> ntag_interface_;
  std::array<byte, 16> terminal_key_bytes_;

  os_thread_return_t NfcThread();

 private:
  //  Main loop for NfcThread
  void NfcLoop(NfcStateData &data);

  void WaitForTag(NfcStateData &data);

  bool CheckTagStillAvailable(NfcStateData &data);

  void TagPerformQueuedAction(NfcStateData &data);

  void TagError(NfcStateData &data);
};
