// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/machine_control/xtool_machine_sensor.h"

#include <optional>
#include <string_view>

#include "gtest/gtest.h"
#include "pb_socket/mock/mock_tcp_socket.h"
#include "pw_bytes/span.h"
#include "pw_thread_stl/options.h"

namespace maco::machine_control {
namespace {

using namespace std::chrono_literals;

// --- ParseWorking (pure) ---

TEST(XToolParseWorking, IdleReturnsNotRunning) {
  EXPECT_EQ(XToolMachineSensor::ParseWorking(R"({"result":"ok","working":"0"})"),
            std::make_optional(false));
}

TEST(XToolParseWorking, RunningViaApi) {
  EXPECT_EQ(XToolMachineSensor::ParseWorking(R"({"result":"ok","working":"1"})"),
            std::make_optional(true));
}

TEST(XToolParseWorking, RunningViaDeviceButton) {
  EXPECT_EQ(XToolMachineSensor::ParseWorking(R"({"working":"2"})"),
            std::make_optional(true));
}

TEST(XToolParseWorking, MissingFieldReturnsNullopt) {
  EXPECT_EQ(XToolMachineSensor::ParseWorking(R"({"result":"ok"})"),
            std::nullopt);
}

TEST(XToolParseWorking, KeyWithoutValueYetReturnsNullopt) {
  // Partial buffer: key present but the digit hasn't arrived yet.
  EXPECT_EQ(XToolMachineSensor::ParseWorking(R"({"result":"ok","working":")"),
            std::nullopt);
}

TEST(XToolParseWorking, EmptyReturnsNullopt) {
  EXPECT_EQ(XToolMachineSensor::ParseWorking(""), std::nullopt);
}

// --- PollOnce over a mock socket ---

// Test subclass exposing the protected synchronous poll.
class TestableSensor : public XToolMachineSensor {
 public:
  using XToolMachineSensor::PollOnce;
  using XToolMachineSensor::XToolMachineSensor;
};

class XToolPollTest : public ::testing::Test {
 protected:
  void Enqueue(std::string_view body) {
    socket_.EnqueueReadData(
        pw::as_bytes(pw::span<const char>(body.data(), body.size())));
  }

  static constexpr std::string_view kRunningResponse =
      "HTTP/1.0 200 OK\r\n\r\n{\"result\":\"ok\",\"working\":\"1\"}";
  static constexpr std::string_view kIdleResponse =
      "HTTP/1.0 200 OK\r\n\r\n{\"result\":\"ok\",\"working\":\"0\"}";

  pb::socket::MockTcpSocket socket_;
  pw::thread::stl::Options thread_options_;
  TestableSensor sensor_{socket_, 3s, thread_options_};
};

TEST_F(XToolPollTest, ReportsRunningWhenCutting) {
  Enqueue(kRunningResponse);
  EXPECT_TRUE(sensor_.PollOnce());
}

TEST_F(XToolPollTest, ReportsIdleWhenNotCutting) {
  Enqueue(kIdleResponse);
  EXPECT_FALSE(sensor_.PollOnce());
}

TEST_F(XToolPollTest, UnreachableLaserReportsNotRunning) {
  socket_.set_connect_should_fail(true);
  EXPECT_FALSE(sensor_.PollOnce());
}

TEST_F(XToolPollTest, PollDisconnectsAfterResponse) {
  Enqueue(kRunningResponse);
  sensor_.PollOnce();
  // HTTP/1.0: the socket is closed after each poll so the next reconnects.
  EXPECT_FALSE(socket_.IsConnected());
}

}  // namespace
}  // namespace maco::machine_control
