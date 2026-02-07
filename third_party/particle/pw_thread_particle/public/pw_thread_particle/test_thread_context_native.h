// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_thread_particle/context.h"
#include "pw_thread_particle/options.h"

namespace pw::thread::test::backend {

// Native Test Thread Options backend class for Particle Device OS.
class TestThreadContextNative {
 public:
  static constexpr size_t kStackSizeBytes = 8192;

  constexpr TestThreadContextNative() : context_(kConstexpr) {
    options_.set_static_context(context_);
  }

  TestThreadContextNative(const TestThreadContextNative&) = delete;
  TestThreadContextNative& operator=(const TestThreadContextNative&) = delete;

  ~TestThreadContextNative() = default;

  const Options& options() const { return options_; }

 private:
  particle::Options options_;
  particle::StaticContextWithStack<kStackSizeBytes> context_;
};

}  // namespace pw::thread::test::backend
