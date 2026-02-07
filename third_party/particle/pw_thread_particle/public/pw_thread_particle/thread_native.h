// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_thread_particle/context.h"

namespace pw::thread::backend {

// The native thread is a pointer to a thread's context.
using NativeThread = pw::thread::particle::Context*;

// The native thread handle is the same as the NativeThread.
using NativeThreadHandle = pw::thread::particle::Context*;

}  // namespace pw::thread::backend
