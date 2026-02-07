// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pw_thread/thread.h"

#include "concurrent_hal.h"
#include "pw_assert/check.h"
#include "pw_preprocessor/compiler.h"
#include "pw_thread_particle/config.h"
#include "pw_thread_particle/context.h"
#include "pw_thread_particle/options.h"

using pw::thread::particle::Context;

namespace pw::thread {

void Context::ThreadEntryPoint(void* void_context_ptr) {
  Context& context = *static_cast<Context*>(void_context_ptr);

  // Invoke the user's thread function. This may never return.
  context.fn_();
  context.fn_ = nullptr;

  // Use a critical section to guard against join() and detach().
  // This prevents a race where detach() could delete the context while we're
  // still accessing it.
  os_thread_scheduling(false, nullptr);

  if (context.detached()) {
    // Thread was detached before we finished. We're responsible for cleanup.
    // Clear handle so the context can potentially be reused.
    context.set_thread_handle(nullptr);

    // Resume scheduler before cleanup and exit.
    os_thread_scheduling(true, nullptr);

    if (context.dynamically_allocated_) {
      delete &context;
    }

    // Exit the thread. This never returns.
    os_thread_exit(nullptr);
    PW_UNREACHABLE;
  }

  // Thread finished before detach/join. Defer cleanup to the joiner/detacher.
  context.set_thread_done();
  os_thread_scheduling(true, nullptr);

  // Exit the thread. This signals to os_thread_join that we're done.
  os_thread_exit(nullptr);
  PW_UNREACHABLE;
}

void Context::TerminateThread(Context& context) {
  // Clean up the thread resources.
  if (context.thread_handle() != nullptr) {
    os_thread_cleanup(context.thread_handle());
    context.set_thread_handle(nullptr);
  }

  if (context.dynamically_allocated_) {
    delete &context;
  }
}

void Context::CreateThread(const particle::Options& options,
                           Function<void()>&& thread_fn,
                           Context*& native_type_out) {
  os_thread_t thread_handle = nullptr;

  // Always use dynamic allocation and os_thread_create.
  // Note: os_thread_create_with_stack is not available in dynalib.
  // Static contexts are stored but we still use os_thread_create for the stack.
  if (options.static_context() != nullptr) {
    // Use the statically allocated context for the Context object.
    native_type_out = options.static_context();
    PW_DCHECK(native_type_out->thread_handle() == nullptr,
              "Cannot reuse a context that is still in use");

    // Reset the state of the static context in case it was re-used.
    native_type_out->set_detached(false);
    native_type_out->set_thread_done(false);
    native_type_out->dynamically_allocated_ = false;

    native_type_out->set_thread_routine(std::move(thread_fn));
  } else {
    // Dynamically allocate the context.
    native_type_out = new pw::thread::particle::Context();
    native_type_out->dynamically_allocated_ = true;
    native_type_out->set_detached(false);
    native_type_out->set_thread_done(false);

    native_type_out->set_thread_routine(std::move(thread_fn));
  }

  // Create thread with dynamically allocated stack (os_thread_create).
  // The stack_size from options is used regardless of static/dynamic context.
  const os_result_t result = os_thread_create(
      &thread_handle,
      options.name(),
      options.priority(),
      Context::ThreadEntryPoint,
      native_type_out,
      options.stack_size_bytes());

  PW_CHECK(result == 0, "Failed to create thread");
  PW_CHECK(thread_handle != nullptr, "Thread handle is null after creation");
  native_type_out->set_thread_handle(thread_handle);
}

Thread::Thread(const thread::Options& facade_options, Function<void()>&& entry)
    : native_type_(nullptr) {
  // Cast the generic facade options to the backend specific option.
  auto options = static_cast<const particle::Options&>(facade_options);
  Context::CreateThread(options, std::move(entry), native_type_);
}

void Thread::detach() {
  PW_CHECK(joinable());

  // Use a critical section to safely check thread_done and set detached.
  // This prevents a race with ThreadEntryPoint.
  os_thread_scheduling(false, nullptr);
  native_type_->set_detached();
  const bool thread_done = native_type_->thread_done();
  os_thread_scheduling(true, nullptr);

  if (thread_done) {
    // The task finished before we invoked detach, clean up the thread.
    Context::TerminateThread(*native_type_);
  }
  // Otherwise, cleanup will happen when the thread exits.

  // Update to no longer represent a thread of execution.
  native_type_ = nullptr;
}

#if PW_THREAD_JOINING_ENABLED
void Thread::join() {
  PW_CHECK(joinable());
  PW_CHECK(this_thread::get_id() != get_id(), "Cannot join self");

  // Wait for the thread to finish.
  os_result_t result = os_thread_join(native_type_->thread_handle());
  PW_CHECK(result == 0, "Failed to join thread");

  // Clean up the thread resources.
  Context::TerminateThread(*native_type_);

  // Update to no longer represent a thread of execution.
  native_type_ = nullptr;
}
#endif  // PW_THREAD_JOINING_ENABLED

}  // namespace pw::thread
