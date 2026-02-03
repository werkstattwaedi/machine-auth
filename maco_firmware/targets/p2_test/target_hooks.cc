// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pw_system/target_hooks.h"

#include "pw_thread/detached_thread.h"
#include "pw_thread/thread.h"
#include "pw_thread_particle/options.h"

namespace pw::system {

const thread::Options& LogThreadOptions() {
  static constexpr auto options =
      pw::thread::particle::Options()
          .set_name("LogThread")
          .set_stack_size(4096);
  return options;
}

const thread::Options& RpcThreadOptions() {
  static constexpr auto options =
      pw::thread::particle::Options()
          .set_name("RpcThread")
          .set_stack_size(16384);
  return options;
}

const thread::Options& TransferThreadOptions() {
  static constexpr auto options =
      pw::thread::particle::Options()
          .set_name("TransferThread")
          .set_stack_size(2048);
  return options;
}

const thread::Options& WorkQueueThreadOptions() {
  static constexpr auto options =
      pw::thread::particle::Options()
          .set_name("WorkQueueThread")
          .set_stack_size(8192);
  return options;
}

}  // namespace pw::system
