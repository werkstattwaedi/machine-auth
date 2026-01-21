// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file host_gateway_client.h
/// @brief Host implementation of GatewayClient using POSIX sockets.

#include <array>
#include <memory>

#include "gateway/gateway_client.h"
#include "pw_async2/dispatcher.h"
#include "pw_rpc/channel.h"

namespace maco::gateway {

/// Host implementation of GatewayClient.
///
/// Uses standard POSIX sockets for TCP and AsconChannelOutput for
/// ASCON encryption. Suitable for the host simulator.
class HostGatewayClient : public GatewayClient {
 public:
  /// Create a host gateway client.
  ///
  /// @param config Gateway configuration including host, port, key, etc.
  explicit HostGatewayClient(const GatewayConfig& config);

  ~HostGatewayClient() override;

  // Non-copyable, non-movable
  HostGatewayClient(const HostGatewayClient&) = delete;
  HostGatewayClient& operator=(const HostGatewayClient&) = delete;
  HostGatewayClient(HostGatewayClient&&) = delete;
  HostGatewayClient& operator=(HostGatewayClient&&) = delete;

  // GatewayClient interface
  void Start(pw::async2::Dispatcher& dispatcher) override;
  pw::rpc::Client& rpc_client() override;
  uint32_t channel_id() const override { return config_.channel_id; }
  bool IsConnected() const override;
  pw::Status Connect() override;
  void Disconnect() override;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  GatewayConfig config_;
};

}  // namespace maco::gateway
