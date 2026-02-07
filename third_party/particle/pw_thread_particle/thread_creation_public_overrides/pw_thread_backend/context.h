// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Generic thread creation backend context for Particle Device OS.
#pragma once

#include <cstddef>

#include "pw_thread_particle/config.h"
#include "pw_thread_particle/context.h"
#include "pw_toolchain/constexpr_tag.h"

namespace pw::thread::backend {

// Particle Device OS always uses static allocation for threads.
using NativeContext = ::pw::thread::particle::StaticContext;

template <size_t kStackSizeBytes>
class NativeContextWithStack {
 public:
  constexpr NativeContextWithStack() : context_with_stack_(kConstexpr) {}

  auto& context() { return context_with_stack_; }
  const auto& context() const { return context_with_stack_; }

 private:
  particle::StaticContextWithStack<kStackSizeBytes> context_with_stack_;
};

}  // namespace pw::thread::backend
