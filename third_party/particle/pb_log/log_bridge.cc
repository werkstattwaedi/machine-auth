// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Minimal HAL-level bridge from Particle Device OS logging to pw_log.
// This intercepts all system and application logs via log_set_callbacks().
//
// Thread safety is handled by pw_sys_io - each PW_LOG call uses WriteLine
// which is atomic.

#include "pb_log/log_bridge.h"

#include <cstddef>

#include "logging.h"

#define PW_LOG_MODULE_NAME "device_os"
#define PW_LOG_LEVEL PW_LOG_LEVEL_WARN

#include "pw_log/log.h"
#include "pw_sys_io/sys_io.h"

namespace pb::log {
namespace {

// Map Particle log levels to appropriate PW_LOG calls
void LogMessageCallback(const char* msg, int level, const char* category,
                        const LogAttributes* attr, void* reserved) {
  (void)attr;
  (void)reserved;

  const char* cat = category ? category : "system";

  // Map Particle levels to pw_log levels
  // Particle: TRACE=1, INFO=30, WARN=40, ERROR=50, PANIC=60
  if (level >= LOG_LEVEL_PANIC) {
    PW_LOG_CRITICAL("[%s] %s", cat, msg);
  } else if (level >= LOG_LEVEL_ERROR) {
    PW_LOG_ERROR("[%s] %s", cat, msg);
  } else if (level >= LOG_LEVEL_WARN) {
    PW_LOG_WARN("[%s] %s", cat, msg);
  } else if (level >= LOG_LEVEL_INFO) {
    PW_LOG_INFO("[%s] %s", cat, msg);
  } else {
    PW_LOG_DEBUG("[%s] %s", cat, msg);
  }
}

void LogWriteCallback(const char* data, size_t size, int level,
                      const char* category, void* reserved) {
  (void)level;
  (void)category;
  (void)reserved;

  // Write raw data directly through pw_sys_io (thread-safe)
  for (size_t i = 0; i < size; i++) {
    (void)pw::sys_io::WriteByte(static_cast<std::byte>(data[i]));
  }
}

int LogEnabledCallback(int level, const char* category, void* reserved) {
  (void)category;
  (void)reserved;

  // Enable all levels - pw_log will do its own filtering
  (void)level;
  return 1;
}

}  // namespace

void InitLogBridge() {
  log_set_callbacks(LogMessageCallback, LogWriteCallback, LogEnabledCallback,
                    nullptr);
}

}  // namespace pb::log
