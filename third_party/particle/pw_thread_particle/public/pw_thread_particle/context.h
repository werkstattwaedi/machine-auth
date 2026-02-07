// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstddef>
#include <cstdint>

#include "pw_function/function.h"
#include "pw_span/span.h"
#include "pw_thread_particle/config.h"
#include "pw_toolchain/constexpr_tag.h"

// Forward declaration of Device OS types
typedef void* os_thread_t;

namespace pw {

template <size_t>
class ThreadContext;

namespace thread {

class Thread;

namespace particle {

class Options;

// Context for a Particle thread. This contains the thread handle and
// the function to execute.
class Context {
 public:
  constexpr Context() = default;
  Context(const Context&) = delete;
  Context& operator=(const Context&) = delete;

 private:
  friend Thread;
  friend class StaticContext;

  static void CreateThread(const particle::Options& options,
                           Function<void()>&& thread_fn,
                           Context*& native_type_out);

  os_thread_t thread_handle() const { return thread_handle_; }
  void set_thread_handle(os_thread_t handle) { thread_handle_ = handle; }

  void set_thread_routine(Function<void()>&& rvalue) {
    fn_ = std::move(rvalue);
  }

  bool detached() const { return detached_; }
  void set_detached(bool value = true) { detached_ = value; }

  bool thread_done() const { return thread_done_; }
  void set_thread_done(bool value = true) { thread_done_ = value; }

  static void ThreadEntryPoint(void* void_context_ptr);
  static void TerminateThread(Context& context);

  os_thread_t thread_handle_ = nullptr;
  Function<void()> fn_;
  bool detached_ = false;
  bool thread_done_ = false;
  bool dynamically_allocated_ = false;

  // Stack storage for static contexts
  uint8_t* stack_storage_ = nullptr;
  size_t stack_size_ = 0;
};

// Static thread context with pre-allocated stack.
class StaticContext : public Context {
 public:
  explicit constexpr StaticContext(span<uint8_t> stack_span)
      : stack_span_(stack_span) {
    stack_storage_ = stack_span.data();
    stack_size_ = stack_span.size();
  }

 private:
  friend Context;

  template <size_t>
  friend class ::pw::ThreadContext;

  constexpr StaticContext() = default;

  span<uint8_t> stack() { return stack_span_; }

  span<uint8_t> stack_span_;
};

// Static thread context with embedded stack storage.
template <size_t kStackSizeBytes = config::kDefaultStackSizeBytes>
class StaticContextWithStack final : public StaticContext {
 public:
  StaticContextWithStack() : StaticContext(stack_storage_) {}

  // Constexpr constructor for static initialization.
  constexpr StaticContextWithStack(ConstexprTag)
      : StaticContext(stack_storage_), stack_storage_{} {}

 private:
  static_assert(kStackSizeBytes >= config::kMinimumStackSizeBytes);
  uint8_t stack_storage_[kStackSizeBytes];
};

}  // namespace particle
}  // namespace thread
}  // namespace pw
