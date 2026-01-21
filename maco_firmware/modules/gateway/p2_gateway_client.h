// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file p2_gateway_client.h
/// @brief P2 implementation of GatewayClient using Device OS sockets.

#include <array>
#include <memory>

#include "gateway/gateway_client.h"
#include "pw_async2/dispatcher.h"
#include "pw_rpc/channel.h"

namespace maco::gateway {

/// P2 implementation of GatewayClient.
///
/// Uses pb_socket::ParticleTcpClient for TCP and AsconChannelOutput for
/// ASCON encryption. Connection is managed automatically with transparent
/// reconnection on failure.
///
/// Usage:
/// @code
///   P2GatewayClient gateway(config);
///   gateway.Start(dispatcher);  // Start read task
///
///   // Now RPC calls will work
///   FirebaseClient firebase(gateway.rpc_client(), gateway.channel_id());
/// @endcode
class P2GatewayClient : public GatewayClient {
 public:
  /// Create a P2 gateway client.
  ///
  /// @param config Gateway configuration including host, port, key, etc.
  explicit P2GatewayClient(const GatewayConfig& config);

  ~P2GatewayClient() override;

  // Non-copyable, non-movable
  P2GatewayClient(const P2GatewayClient&) = delete;
  P2GatewayClient& operator=(const P2GatewayClient&) = delete;
  P2GatewayClient(P2GatewayClient&&) = delete;
  P2GatewayClient& operator=(P2GatewayClient&&) = delete;

  // GatewayClient interface
  void Start(pw::async2::Dispatcher& dispatcher) override;
  pw::rpc::Client& rpc_client() override;
  uint32_t channel_id() const override { return config_.channel_id; }
  bool IsConnected() const override;
  pw::Status Connect() override;
  void Disconnect() override;

 private:
  // Pimpl to hide implementation details
  struct Impl;
  std::unique_ptr<Impl> impl_;
  GatewayConfig config_;
};

}  // namespace maco::gateway
