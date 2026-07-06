// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <optional>
#include <string_view>

#include "maco_firmware/modules/machine_control/machine_sensor.h"
#include "pb_socket/tcp_socket.h"
#include "pw_async2/dispatcher.h"
#include "pw_chrono/system_clock.h"
#include "pw_thread/thread.h"

namespace maco::machine_control {

/// Senses whether an xTool P2S laser is actively cutting.
///
/// Polls the laser's local HTTP API
/// (`GET /system?action=get_working_sta`) over the LAN and reports the
/// machine as "running" while a job is executing (`working` != "0").
///
/// The TCP calls (connect/write/read) are synchronous and can block (a
/// connect to an unreachable laser blocks for the connect timeout), so the
/// poll loop runs on its own dedicated thread rather than the shared
/// async2 dispatcher — otherwise an offline laser would freeze NFC auth,
/// the UI, and session timeouts. See maco_firmware/CLAUDE.md (no blocking on
/// the dispatcher).
///
/// The laser being unreachable or an unparseable response is treated as
/// "not running" (idle) — this is what makes a forgotten session idle out
/// and auto-end rather than latch green forever.
class XToolMachineSensor : public MachineSensor {
 public:
  XToolMachineSensor(pb::socket::TcpSocket& socket,
                     pw::chrono::SystemClock::duration poll_interval,
                     const pw::thread::Options& thread_options);

  /// Spawns the dedicated poll thread. The dispatcher argument is unused
  /// (this sensor does not run on the shared dispatcher); it is accepted to
  /// satisfy the MachineSensor interface.
  void Start(pw::async2::Dispatcher& dispatcher) override;

  /// Parse the laser's `get_working_sta` response body.
  ///
  /// Returns the running state (true = cutting) when the `working` field is
  /// found, or nullopt when the response can't be interpreted. Exposed
  /// (and static) for unit testing.
  static std::optional<bool> ParseWorking(std::string_view response);

 protected:
  /// Perform one poll round-trip synchronously. Returns the running state,
  /// or false on any connection/read/parse error. Exposed for unit testing.
  bool PollOnce();

 private:
  void PollLoop();

  pb::socket::TcpSocket& socket_;
  pw::chrono::SystemClock::duration poll_interval_;
  const pw::thread::Options& thread_options_;
  std::atomic<bool> running_{false};
};

}  // namespace maco::machine_control
