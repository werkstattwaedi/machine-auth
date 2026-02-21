// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "STACK"

#include "maco_firmware/modules/stack_monitor/stack_monitor.h"

#include <cstring>

#include "pw_log/log.h"
#include "pw_thread/detached_thread.h"
#include "pw_thread/sleep.h"
#include "pw_thread/thread_info.h"
#include "pw_thread/thread_iteration.h"
#include "maco_firmware/system/system.h"

namespace maco {
namespace {

constexpr float kMinHeadroomPercent = 20.0f;

// Written once before thread start, read only by the monitor thread.
// Thread creation on FreeRTOS implies a full memory barrier, establishing
// a happens-before relationship. Function-local statics avoid capture
// (pw_function inline limit is 4 bytes on ARM).
pw::chrono::SystemClock::duration monitor_interval;
ThreadWatermarkCallback thread_metric_callback;

struct ThreadRecord {
  char name[32];
  uint32_t peak_used;
  uint32_t total;
  float headroom_pct;
};

constexpr size_t kMaxThreads = 16;

struct ThreadSnapshot {
  ThreadRecord records[kMaxThreads];
  size_t count;
};

// Function-local static accessed by the captureless ForEachThread callback.
// Only called from the single monitor thread, so no concurrent access.
ThreadSnapshot& GetSnapshot() {
  static ThreadSnapshot snapshot;
  return snapshot;
}

// Collect thread info first, log after ForEachThread returns.
// The ForEachThread callback may run with the scheduler disabled, so it must
// not call anything that could block (PW_LOG may acquire a mutex or block on
// UART). We copy the data we need into a local array and log afterwards.
// The per-thread metric callback is also invoked after ForEachThread returns,
// so it too is safe to call blocking APIs.
void LogStackWatermarks() {
  auto& snapshot = GetSnapshot();
  snapshot.count = 0;

  auto status = pw::thread::ForEachThread(
      [](const pw::thread::ThreadInfo& info) -> bool {
        auto& snap = GetSnapshot();
        if (snap.count >= kMaxThreads) return false;

        auto& rec = snap.records[snap.count];

        auto name_bytes = info.thread_name();
        std::memcpy(rec.name, "(unnamed)", 10);
        if (name_bytes.has_value()) {
          size_t len = name_bytes->size();
          if (len > sizeof(rec.name) - 1) {
            len = sizeof(rec.name) - 1;
          }
          std::memcpy(rec.name, name_bytes->data(), len);
          rec.name[len] = '\0';
        }

        auto low = info.stack_low_addr();
        auto high = info.stack_high_addr();
        auto peak = info.stack_peak_addr();

        if (!low.has_value() || !high.has_value() || !peak.has_value()) {
          return true;  // Continue iteration, skip this thread
        }

        rec.total = *high - *low;
        rec.peak_used = *high - *peak;
        rec.headroom_pct =
            rec.total > 0
                ? 100.0f * static_cast<float>(rec.total - rec.peak_used) /
                      static_cast<float>(rec.total)
                : 0.0f;

        snap.count++;
        return true;
      });

  if (status.IsUnimplemented()) {
    // Host (pw_thread_stl) doesn't support thread iteration — silently skip.
    return;
  }
  if (!status.ok()) {
    PW_LOG_WARN("ForEachThread failed: %d", static_cast<int>(status.code()));
    return;
  }

  // Log after ForEachThread returns — safe to block now.
  for (size_t i = 0; i < snapshot.count; i++) {
    auto& rec = snapshot.records[i];
    PW_LOG_DEBUG("Stack [%s]: %u/%u bytes peak (%.0f%% headroom)",
                 rec.name,
                 static_cast<unsigned>(rec.peak_used),
                 static_cast<unsigned>(rec.total),
                 static_cast<double>(rec.headroom_pct));

    if (rec.headroom_pct < kMinHeadroomPercent) {
      PW_LOG_WARN("Stack [%s]: headroom %.0f%% below %.0f%% threshold!",
                  rec.name,
                  static_cast<double>(rec.headroom_pct),
                  static_cast<double>(kMinHeadroomPercent));
    }

    if (thread_metric_callback != nullptr) {
      uint32_t free_words = (rec.total - rec.peak_used) / sizeof(uint32_t);
      thread_metric_callback(rec.name, free_words);
    }
  }
}

}  // namespace

void StartStackMonitor(pw::chrono::SystemClock::duration interval,
                       ThreadWatermarkCallback per_thread_callback) {
  monitor_interval = interval;
  thread_metric_callback = per_thread_callback;

  pw::thread::DetachedThread(
      maco::system::GetDefaultThreadOptions(), []() {
        // Initial delay: let all threads start and exercise their init paths
        pw::this_thread::sleep_for(std::chrono::seconds(5));

        while (true) {
          LogStackWatermarks();
          pw::this_thread::sleep_for(monitor_interval);
        }
      });
}

}  // namespace maco
