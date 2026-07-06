// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "XSEN"

#include "maco_firmware/modules/machine_control/xtool_machine_sensor.h"

#include <array>

#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"
#include "pw_thread/detached_thread.h"
#include "pw_thread/sleep.h"

namespace maco::machine_control {

using namespace std::chrono_literals;

namespace {

// Minimal HTTP/1.0 request. HTTP/1.0 defaults to Connection: close, so the
// laser closes the socket after the response and we reconnect each poll.
constexpr std::string_view kRequest =
    "GET /system?action=get_working_sta HTTP/1.0\r\n\r\n";

// Bound on how long we wait for a single response before giving up.
constexpr auto kReadPollInterval = 50ms;
constexpr int kMaxReadPolls = 40;  // ~2s total

}  // namespace

XToolMachineSensor::XToolMachineSensor(
    pb::socket::TcpSocket& socket,
    pw::chrono::SystemClock::duration poll_interval,
    const pw::thread::Options& thread_options)
    : socket_(socket),
      poll_interval_(poll_interval),
      thread_options_(thread_options) {}

void XToolMachineSensor::Start(pw::async2::Dispatcher& /*dispatcher*/) {
  running_.store(true);
  pw::thread::DetachedThread(thread_options_, [this]() { PollLoop(); });
}

std::optional<bool> XToolMachineSensor::ParseWorking(std::string_view response) {
  constexpr std::string_view kKey = "\"working\"";
  size_t key_pos = response.find(kKey);
  if (key_pos == std::string_view::npos) {
    return std::nullopt;
  }
  // Skip forward to the first digit after the key (past `":` and quotes).
  for (size_t i = key_pos + kKey.size(); i < response.size(); ++i) {
    char c = response[i];
    if (c >= '0' && c <= '9') {
      // "0" = idle; "1"/"2" = running (API start / device-button start).
      return c != '0';
    }
    // Only whitespace, ':' and '"' are expected between key and value.
    if (c != ':' && c != '"' && c != ' ' && c != '\t') {
      return std::nullopt;
    }
  }
  return std::nullopt;
}

bool XToolMachineSensor::PollOnce() {
  if (!socket_.IsConnected()) {
    if (auto status = socket_.Connect(); !status.ok()) {
      return false;
    }
  }

  if (auto status = socket_.Write(
          pw::as_bytes(pw::span<const char>(kRequest.data(), kRequest.size())));
      !status.ok()) {
    socket_.Disconnect();
    return false;
  }

  std::array<char, 512> buf{};
  size_t total = 0;
  int idle_polls = 0;
  while (total < buf.size()) {
    auto span = pw::as_writable_bytes(
        pw::span<char>(buf.data() + total, buf.size() - total));
    auto result = socket_.Read(span);
    if (!result.ok()) {
      // OutOfRange => peer closed (response complete); anything else is an
      // error. Either way, stop reading and parse what we have.
      break;
    }
    if (result.size() == 0) {
      if (++idle_polls > kMaxReadPolls) {
        break;
      }
      pw::this_thread::sleep_for(kReadPollInterval);
      continue;
    }
    idle_polls = 0;
    total += result.size();
    // Stop as soon as the value is unambiguous.
    if (auto parsed = ParseWorking(std::string_view(buf.data(), total));
        parsed.has_value()) {
      socket_.Disconnect();
      return *parsed;
    }
  }

  socket_.Disconnect();
  return ParseWorking(std::string_view(buf.data(), total)).value_or(false);
}

void XToolMachineSensor::PollLoop() {
  // Contract: notify the initial state once before entering the loop cadence.
  NotifyRunning(PollOnce());
  while (running_.load(std::memory_order_relaxed)) {
    pw::this_thread::sleep_for(poll_interval_);
    NotifyRunning(PollOnce());
  }
}

}  // namespace maco::machine_control
