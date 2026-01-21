// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file mock_gateway_client.h
/// @brief Mock GatewayClient for testing without network.

#include <array>
#include <functional>
#include <memory>
#include <queue>
#include <vector>

#include "gateway/gateway_client.h"
#include "gateway/gateway_service.pwpb.h"
#include "pw_async2/dispatcher.h"
#include "pw_rpc/channel.h"
#include "pw_rpc/internal/fake_channel_output.h"

namespace maco::gateway {

/// Mock channel output that captures sent packets.
class MockChannelOutput : public pw::rpc::ChannelOutput {
 public:
  explicit MockChannelOutput(const char* name = "mock")
      : ChannelOutput(name) {}

  pw::Status Send(pw::span<const std::byte> buffer) override {
    sent_packets_.emplace_back(buffer.begin(), buffer.end());
    return send_status_;
  }

  size_t MaximumTransmissionUnit() override { return 512; }

  /// Set the status to return from Send().
  void set_send_status(pw::Status status) { send_status_ = status; }

  /// Get sent packets for verification.
  const std::vector<std::vector<std::byte>>& sent_packets() const {
    return sent_packets_;
  }

  /// Clear sent packets.
  void ClearSentPackets() { sent_packets_.clear(); }

 private:
  pw::Status send_status_ = pw::OkStatus();
  std::vector<std::vector<std::byte>> sent_packets_;
};

/// Mock GatewayClient for testing.
///
/// Provides a pw_rpc client that doesn't require network connectivity.
/// Test code can inject responses for RPC calls.
///
/// Usage:
/// @code
///   MockGatewayClient mock;
///
///   // Make RPC calls - they'll use the mock channel
///   FirebaseClient firebase(mock.rpc_client(), mock.channel_id());
///   // ...
///
///   // Verify sent packets
///   EXPECT_EQ(mock.channel_output().sent_packets().size(), 1);
/// @endcode
class MockGatewayClient : public GatewayClient {
 public:
  explicit MockGatewayClient(uint32_t channel_id = 1)
      : channel_id_(channel_id),
        channel_output_("mock_gateway"),
        channels_{pw::rpc::Channel(channel_id_, &channel_output_)},
        rpc_client_(channels_) {}

  ~MockGatewayClient() override = default;

  // GatewayClient interface
  void Start(pw::async2::Dispatcher& /*dispatcher*/) override {
    // Mock doesn't need a read task - responses are injected directly
  }

  pw::rpc::Client& rpc_client() override { return rpc_client_; }
  uint32_t channel_id() const override { return channel_id_; }
  bool IsConnected() const override { return connected_; }

  pw::Status Connect() override {
    connected_ = true;
    return pw::OkStatus();
  }

  void Disconnect() override { connected_ = false; }

  /// Get the mock channel output for verification/injection.
  MockChannelOutput& channel_output() { return channel_output_; }

  /// Set connected state for testing.
  void set_connected(bool connected) { connected_ = connected; }

 private:
  uint32_t channel_id_;
  MockChannelOutput channel_output_;
  std::array<pw::rpc::Channel, 1> channels_;
  pw::rpc::Client rpc_client_;
  bool connected_ = false;
};

}  // namespace maco::gateway
