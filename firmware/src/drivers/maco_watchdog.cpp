#include "maco_watchdog.h"

namespace oww::drivers {

Logger MacoWatchdog::logger("app.watchdog");
MacoWatchdog* MacoWatchdog::instance_ = nullptr;

MacoWatchdog& MacoWatchdog::instance() {
  if (!instance_) {
    instance_ = new MacoWatchdog();
  }
  return *instance_;
}

MacoWatchdog::MacoWatchdog() {
  // Initialize all last_ping_ timestamps to 0
  last_ping_.fill(0);

  // Initialize ping counts to 0
  ping_count_.fill(0);

  // Start with boot timeout (60s) - will be reduced to 10s after boot
  thread_timeout_ = kBootTimeout;
}

void MacoWatchdog::Begin() {
  os_mutex_create(&mutex_);

  // Initialize all threads with current timestamp
  auto now = millis();
  os_mutex_lock(mutex_);
  for (size_t i = 0; i < kObservedThreadCount; i++) {
    last_ping_[i] = now;
  }
  last_report_time_ = now;
  os_mutex_unlock(mutex_);

  // Initialize hardware watchdog (60 second timeout)
  Watchdog.init(WatchdogConfiguration().timeout(60s));
  Watchdog.start();

  logger.info(
      "MacoWatchdog initialized (hardware watchdog: 60s, thread timeout: %lus)",
      thread_timeout_ / 1000);
}

void MacoWatchdog::SetThreadTimeout(system_tick_t timeout_ms) {
  os_mutex_lock(mutex_);
  thread_timeout_ = timeout_ms;
  os_mutex_unlock(mutex_);

  logger.info("Thread timeout changed to %lus", timeout_ms / 1000);
}

void MacoWatchdog::Ping(ObservedThread thread) {
  auto now = millis();

  os_mutex_lock(mutex_);
  last_ping_[static_cast<int>(thread)] = now;
  ping_count_[static_cast<int>(thread)]++;

  os_mutex_unlock(mutex_);

  // Refresh hardware watchdog to keep it alive
  Watchdog.refresh();

  // Check for timeouts and report statistics
  Check();
}

bool MacoWatchdog::Check() {
  auto now = millis();

  // Throttle: only run full check once per second
  static system_tick_t last_check_time = 0;
  if (now - last_check_time < 1000) {
    return true;  // Early return, assume healthy
  }
  last_check_time = now;

  bool all_healthy = true;
  bool should_reset = false;

  // Collect data while holding lock, then release before doing expensive
  // operations
  struct ThreadData {
    system_tick_t time_since_ping;
    uint32_t ping_count;
    bool timed_out;
  };

  ThreadData thread_data[kObservedThreadCount];
  bool should_report = false;
  float elapsed_seconds = 0.0f;
  system_tick_t current_timeout;

  os_mutex_lock(mutex_);

  current_timeout = thread_timeout_;

  // Collect timeout information
  for (size_t i = 0; i < kObservedThreadCount; i++) {
    thread_data[i].time_since_ping = now - last_ping_[i];
    thread_data[i].ping_count = ping_count_[i];
    thread_data[i].timed_out =
        (thread_data[i].time_since_ping > current_timeout);

    if (thread_data[i].timed_out) {
      all_healthy = false;
#if defined(DEVELOPMENT_BUILD)
      if (thread_data[i].time_since_ping >
          (current_timeout + kResetGracePeriod)) {
        should_reset = true;
      }
#else
      should_reset = true;
#endif
    }
  }

  // Check if we should report frequencies
  auto time_since_report = now - last_report_time_;
  if (time_since_report >= kReportInterval) {
    should_report = true;
    elapsed_seconds = time_since_report / 1000.0f;

    // Reset ping counts and update report time
    for (size_t i = 0; i < kObservedThreadCount; i++) {
      ping_count_[i] = 0;
    }
    last_report_time_ = now;
  }

  os_mutex_unlock(mutex_);

  // Perform system reset if needed
  if (should_reset) {
    std::string unresponsive_threads = "";
    for (size_t i = 0; i < kObservedThreadCount; i++) {
      if (thread_data[i].timed_out) {
        auto thread = static_cast<ObservedThread>(i);
        unresponsive_threads += GetThreadName(thread);
        unresponsive_threads += ", ";
      }
    }
    logger.error("Watchdog: thread unresponsive: [%s]- RESETTING SYSTEM",
                 unresponsive_threads.c_str());

    delay(100);  // Brief delay to ensure log is flushed
    System.reset();
  }

  // Build and log frequency report if needed
  if (should_report) {
    std::string unresponsive_threads = "";
    for (size_t i = 0; i < kObservedThreadCount; i++) {
      if (thread_data[i].timed_out) {
        auto thread = static_cast<ObservedThread>(i);
        unresponsive_threads += GetThreadName(thread);
        unresponsive_threads += ", ";
      }
    }
    if (!unresponsive_threads.empty()) {
      logger.info("Unresponsive threads: %s", unresponsive_threads.c_str());
    }

    std::string report = "Thread ping frequencies (Hz): ";
    for (size_t i = 0; i < kObservedThreadCount; i++) {
      auto thread = static_cast<ObservedThread>(i);
      float frequency = thread_data[i].ping_count / elapsed_seconds;

      if (i > 0) {
        report += ", ";
      }
      report += GetThreadName(thread);
      report += "=";

      char freq_str[16];
      snprintf(freq_str, sizeof(freq_str), "%.1f", frequency);
      report += freq_str;
    }

    logger.info("%s", report.c_str());
  }

  return all_healthy;
}

const char* MacoWatchdog::GetThreadName(ObservedThread thread) {
  switch (thread) {
    case ObservedThread::kMain:
      return "Main";
    case ObservedThread::kNfc:
      return "NFC";
    case ObservedThread::kUi:
      return "UI";
    case ObservedThread::kLed:
      return "LED";
    default:
      return "Unknown";
  }
}

}  // namespace oww::drivers
