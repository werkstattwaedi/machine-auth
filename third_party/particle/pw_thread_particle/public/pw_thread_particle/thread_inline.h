// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_thread/thread.h"

namespace pw::thread {

inline Thread::Thread() : native_type_(nullptr) {}

inline Thread::~Thread() = default;

inline Thread& Thread::operator=(Thread&& other) {
  native_type_ = other.native_type_;
  other.native_type_ = nullptr;
  return *this;
}

inline Thread::id Thread::get_id() const {
  if (native_type_ == nullptr) {
    return Thread::id();
  }
  return Thread::id(native_type_->thread_handle());
}

inline void Thread::swap(Thread& other) {
  using std::swap;
  swap(native_type_, other.native_type_);
}

inline Thread::native_handle_type Thread::native_handle() {
  return native_type_;
}

}  // namespace pw::thread
