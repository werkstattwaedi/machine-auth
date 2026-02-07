// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstddef>

#include "pw_assert/assert.h"
#include "pw_thread/options.h"
#include "pw_thread_particle/config.h"
#include "pw_thread_particle/context.h"

namespace pw::thread::particle {

class Context;

// Thread options for Particle Device OS.
//
// Example usage:
//
//   // Uses the default stack size and priority, but specifies a custom name.
//   pw::Thread example_thread(
//     pw::thread::particle::Options()
//         .set_name("example_thread"),
//     example_thread_function);
//
//   // Provides the name, priority, and pre-allocated context.
//   pw::Thread static_example_thread(
//     pw::thread::particle::Options()
//         .set_name("static_example_thread")
//         .set_priority(7)
//         .set_static_context(static_example_thread_context),
//     example_thread_function);
//
class Options : public thread::Options {
 public:
  constexpr Options() = default;
  constexpr Options(const Options&) = default;
  constexpr Options(Options&&) = default;

  // Sets the name for the thread.
  constexpr Options& set_name(const char* name) {
    name_ = name;
    return *this;
  }

  // Sets the priority for the thread. Device OS priorities typically
  // range from 0-9, with higher numbers being higher priority.
  constexpr Options& set_priority(int priority) {
    priority_ = priority;
    return *this;
  }

  // Set the stack size for dynamic thread allocations.
  constexpr Options& set_stack_size(size_t size_bytes) {
    PW_DASSERT(size_bytes >= config::kMinimumStackSizeBytes);
    stack_size_bytes_ = size_bytes;
    return *this;
  }

  // Set the pre-allocated context (all memory needed to run a thread).
  constexpr Options& set_static_context(StaticContext& context) {
    context_ = &context;
    return *this;
  }

  // Returns name of thread.
  const char* name() const { return name_; }

 private:
  friend Context;

  static constexpr char kDefaultName[] = "pw::Thread";

  int priority() const { return priority_; }
  size_t stack_size_bytes() const { return stack_size_bytes_; }
  StaticContext* static_context() const { return context_; }

  const char* name_ = kDefaultName;
  int priority_ = config::kDefaultPriority;
  size_t stack_size_bytes_ = config::kDefaultStackSizeBytes;
  StaticContext* context_ = nullptr;
};

}  // namespace pw::thread::particle
