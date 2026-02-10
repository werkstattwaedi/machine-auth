// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file gateway_client.h
/// @brief MACO Gateway client providing pw_rpc access to the gateway service.
///
/// The GatewayClient manages the connection to the MACO Gateway including:
/// - TCP connection with automatic reconnection
/// - ASCON-AEAD128 encryption
/// - pw_rpc channel setup
///
/// Three implementations exist:
/// - P2: Uses pb_socket for TCP (Device OS socket HAL)
/// - Host: Uses POSIX sockets for TCP
/// - Mock: For testing without network

#include <array>
#include <cstdint>

#include "gateway/gateway_service.pb.h"
#include "maco_firmware/types.h"
#include "pw_async2/dispatcher.h"
#include "pw_rpc/client.h"
#include "pw_string/string.h"

namespace maco::gateway {

/// Configuration for the gateway connection.
struct GatewayConfig {
  /// Gateway IP address or hostname
  pw::InlineString<64> host;

  /// Gateway port
  uint16_t port = 5000;

  /// Connection timeout in milliseconds
  uint32_t connect_timeout_ms = 10000;

  /// Read timeout in milliseconds
  uint32_t read_timeout_ms = 5000;

  /// Device ID for identification and frame headers
  DeviceId device_id = DeviceId::FromArray({});

  /// 16-byte ASCON encryption key (derived from master secret + device_id)
  std::array<std::byte, 16> key = {};

  /// pw_rpc channel ID for the gateway
  uint32_t channel_id = 1;
};

/// Abstract gateway client interface.
///
/// Provides access to the GatewayService pw_rpc client. Implementations handle
/// the platform-specific transport (TCP + ASCON encryption).
///
/// Lifecycle:
/// 1. Construct with config (acquires resources)
/// 2. Start(dispatcher) - begins async read loop for responses
/// 3. Make RPC calls via FirebaseClient or direct service clients
///
/// Connection is managed automatically:
/// - Connect on first RPC call
/// - Reconnect transparently on connection loss
class GatewayClient {
 public:
  virtual ~GatewayClient() = default;

  /// Start the async read task for processing RPC responses.
  ///
  /// Must be called before making RPC calls. The read task polls for
  /// incoming data and feeds it to pw_rpc for callback processing.
  ///
  /// @param dispatcher The async dispatcher to run the read task on
  virtual void Start(pw::async2::Dispatcher& dispatcher) = 0;

  /// Get the pw_rpc client for making RPC calls.
  ///
  /// Use this to create service clients:
  /// @code
  ///   auto& rpc_client = gateway.rpc_client();
  ///   maco::gateway::pw_rpc::nanopb::GatewayService::Client service_client(
  ///       rpc_client, gateway.channel_id());
  /// @endcode
  virtual pw::rpc::Client& rpc_client() = 0;

  /// Get the channel ID for the gateway.
  virtual uint32_t channel_id() const = 0;

  /// Check if currently connected to the gateway.
  virtual bool IsConnected() const = 0;

  /// Explicitly connect to the gateway.
  ///
  /// Note: Connection is usually automatic on first RPC call.
  /// This method is provided for explicit connection management.
  ///
  /// @return OkStatus on success
  virtual pw::Status Connect() = 0;

  /// Disconnect from the gateway.
  virtual void Disconnect() = 0;
};

}  // namespace maco::gateway
