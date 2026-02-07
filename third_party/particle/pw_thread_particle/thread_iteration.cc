// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pw_thread/thread_iteration.h"

#include <cstddef>
#include <string_view>

#include "concurrent_hal.h"
#include "pw_span/span.h"
#include "pw_status/status.h"
#include "pw_thread/thread_info.h"

namespace pw::thread {
namespace {

// Context for the thread dump callback.
struct DumpContext {
  const ThreadCallback* user_callback;
  bool should_continue;
};

// Callback adapter for os_thread_dump.
os_result_t ThreadDumpCallback(os_thread_dump_info_t* info, void* context) {
  DumpContext* ctx = static_cast<DumpContext*>(context);
  if (!ctx->should_continue) {
    return 0;  // Stop iterating.
  }

  ThreadInfo thread_info;

  // Set thread name if available.
  if (info->name != nullptr) {
    span<const std::byte> name_bytes =
        as_bytes(span(std::string_view(info->name)));
    thread_info.set_thread_name(name_bytes);
  }

  // Set stack info if available.
  if (info->stack_current != nullptr) {
    thread_info.set_stack_pointer(
        reinterpret_cast<uintptr_t>(info->stack_current));
  }
  if (info->stack_base != nullptr) {
    thread_info.set_stack_low_addr(
        reinterpret_cast<uintptr_t>(info->stack_base));
    thread_info.set_stack_high_addr(
        reinterpret_cast<uintptr_t>(info->stack_base) + info->stack_size);
  }

  // Calculate peak usage if high watermark is available.
  if (info->stack_high_watermark > 0 && info->stack_base != nullptr) {
    // High watermark is the max free stack memory recorded.
    // Peak usage = stack_size - high_watermark.
    thread_info.set_stack_peak_addr(
        reinterpret_cast<uintptr_t>(info->stack_base) +
        (info->stack_size - info->stack_high_watermark));
  }

  // Call the user's callback.
  ctx->should_continue = (*ctx->user_callback)(thread_info);
  return 0;  // Continue iterating.
}

}  // namespace

Status ForEachThread(const ThreadCallback& cb) {
  DumpContext ctx{&cb, true};

  // Use nullptr to iterate all threads.
  // Disable scheduling during iteration.
  os_thread_scheduling(false, nullptr);
  os_result_t result = os_thread_dump(nullptr, ThreadDumpCallback, &ctx);
  os_thread_scheduling(true, nullptr);

  if (result != 0) {
    return Status::Internal();
  }
  return OkStatus();
}

}  // namespace pw::thread
