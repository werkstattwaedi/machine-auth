#pragma once

#include "common.h"

namespace oww::drivers {

// Identifiers for threads being monitored
enum class ObservedThread {
  kMain,
  kNfc,
  kUi,
  kCount  // Total number of threads
};

// MacoWatchdog monitors thread liveness by tracking periodic pings
// and manages the hardware watchdog
class MacoWatchdog {
 public:
  // Total number of threads being monitored
  static constexpr size_t kObservedThreadCount =
      static_cast<size_t>(ObservedThread::kCount);

  // Timeout values
  static constexpr system_tick_t kBootTimeout = 60000;    // 60 seconds during boot
  static constexpr system_tick_t kNormalTimeout = 10000;  // 10 seconds after boot

  // Report interval for ping frequency statistics
  static constexpr system_tick_t kReportInterval = 5000;  // 5 seconds

#if defined(DEVELOPMENT_BUILD)
  // Grace period after timeout before resetting (development only)
  static constexpr system_tick_t kResetGracePeriod = 10000;  // 10 seconds
#endif

  // Singleton instance
  static MacoWatchdog& instance();

  // Initialize the watchdog (including hardware watchdog)
  void Begin();

  // Record a ping from a thread
  void Ping(ObservedThread thread);

  // Set the thread timeout (call after boot to reduce from 60s to 10s)
  void SetThreadTimeout(system_tick_t timeout_ms);

 private:
  MacoWatchdog();
  ~MacoWatchdog() = default;

  // Disable copy and move
  MacoWatchdog(const MacoWatchdog&) = delete;
  MacoWatchdog& operator=(const MacoWatchdog&) = delete;

  static Logger logger;
  static MacoWatchdog* instance_;

  // Last ping timestamp for each thread
  std::array<system_tick_t, kObservedThreadCount> last_ping_;

  // Ping count tracking for frequency calculation
  std::array<uint32_t, kObservedThreadCount> ping_count_;

  // Last time we reported statistics
  system_tick_t last_report_time_;

  // Current thread timeout value (starts at kBootTimeout, reduced to kNormalTimeout after boot)
  system_tick_t thread_timeout_;

  // Mutex for thread-safe access
  os_mutex_t mutex_;

  // Get thread name for logging
  const char* GetThreadName(ObservedThread thread);

  // Check all threads for timeouts
  // Returns true if all threads are healthy, false if any thread timed out
  bool Check();
};

}  // namespace oww::drivers
