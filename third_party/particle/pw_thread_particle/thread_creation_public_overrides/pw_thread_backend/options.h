// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Thread options backend for Particle Device OS.
#pragma once

#include "pw_thread_particle/config.h"
#include "pw_thread_particle/context.h"
#include "pw_thread_particle/options.h"

namespace pw::thread::backend {

using NativeOptions = ::pw::thread::particle::Options;

// Convert from ThreadAttrs to NativeOptions for static contexts.
constexpr NativeOptions GetNativeOptions(NativeContext& context,
                                         const ThreadAttrs& attrs) {
  NativeOptions options;
  options.set_name(attrs.name());
  options.set_priority(attrs.priority().native());
  options.set_stack_size(attrs.stack_size_bytes());
  options.set_static_context(context);
  return options;
}

template <size_t kStackSizeBytes>
constexpr NativeOptions GetNativeOptions(
    NativeContextWithStack<kStackSizeBytes>& context,
    const ThreadAttrs& attrs) {
  return GetNativeOptions(context.context(), attrs);
}

}  // namespace pw::thread::backend
