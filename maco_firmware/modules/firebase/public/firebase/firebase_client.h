// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file firebase_client.h
/// @brief Firebase client for typed RPC calls via MACO Gateway.
///
/// This module provides typed wrappers around the generic Forward RPC
/// to Firebase Cloud Functions. Each Firebase endpoint is exposed as a
/// strongly-typed coroutine method that handles serialization and
/// deserialization.
///
/// The FirebaseClient uses a GatewayClient for communication:
/// @code
///   // Create gateway client (platform-specific)
///   maco::gateway::P2GatewayClient gateway(config);
///   gateway.Start(dispatcher);
///
///   // Create Firebase client
///   maco::firebase::FirebaseClient firebase(
///       gateway.rpc_client(), gateway.channel_id());
///
///   // Use in coroutines
///   auto result = co_await firebase.TerminalCheckin(coro_cx, tag_uid);
/// @endcode

#include <cstdint>

#include "common.pwpb.h"
#include "firebase_rpc/auth.pwpb.h"
#include "gateway/gateway_service.pwpb.h"
#include "gateway/gateway_service.rpc.pwpb.h"
#include "pw_async2/coro.h"
#include "pw_async2/value_future.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"
#include "pw_rpc/client.h"
#include "pw_rpc/pwpb/client_reader_writer.h"
#include "pw_status/status.h"

namespace maco::firebase {

// Type aliases for common proto types
using TagUid = maco::proto::pwpb::TagUid::Message;
using FirebaseId = maco::proto::pwpb::FirebaseId::Message;
using Key = maco::proto::pwpb::Key;

// Type aliases for Firebase RPC response types
using TerminalCheckinResponse =
    maco::proto::firebase_rpc::pwpb::TerminalCheckinResponse::Message;
using AuthenticateTagResponse =
    maco::proto::firebase_rpc::pwpb::AuthenticateTagResponse::Message;
using CompleteTagAuthResponse =
    maco::proto::firebase_rpc::pwpb::CompleteTagAuthResponse::Message;

/// Firebase client for making typed RPC calls through the gateway.
///
/// The client wraps the generic Forward RPC and provides typed coroutine
/// methods for each Firebase endpoint. It handles:
/// - Serializing request protos to bytes
/// - Calling the gateway's Forward RPC asynchronously
/// - Deserializing response protos from bytes
///
/// Usage:
/// @code
///   FirebaseClient client(rpc_client, channel_id);
///
///   // In a coroutine:
///   auto result = co_await client.TerminalCheckin(coro_cx, tag_uid);
/// @endcode
///
/// Note: Only one call per method type can be in flight at a time.
/// A second call before the first completes will fail with Unavailable.
class FirebaseClient {
 public:
  /// Constructs a Firebase client.
  ///
  /// @param rpc_client pw_rpc client instance
  /// @param channel_id Channel ID for gateway communication
  FirebaseClient(pw::rpc::Client& rpc_client, uint32_t channel_id);

  /// Check in at terminal with a tag (coroutine).
  ///
  /// Calls the /api/terminalCheckin Firebase endpoint.
  /// Returns authorization info and existing auth if available.
  ///
  /// @param cx Coroutine context for suspension
  /// @param tag_uid The 7-byte NTAG UID
  /// @return TerminalCheckinResponse or error status
  [[nodiscard]] pw::async2::Coro<pw::Result<TerminalCheckinResponse>>
  TerminalCheckin(pw::async2::CoroContext& cx, const TagUid& tag_uid);

  /// Initiate NTAG424 3-pass mutual authentication (coroutine).
  ///
  /// Calls the /api/authenticateTag Firebase endpoint.
  ///
  /// @param cx Coroutine context for suspension
  /// @param tag_uid The 7-byte NTAG UID
  /// @param key_slot Which key slot to authenticate with
  /// @param ntag_challenge Encrypted RndB from tag (Part 1 response)
  /// @return AuthenticateTagResponse or error status
  [[nodiscard]] pw::async2::Coro<pw::Result<AuthenticateTagResponse>>
  AuthenticateTag(pw::async2::CoroContext& cx,
                  const TagUid& tag_uid,
                  Key key_slot,
                  pw::ConstByteSpan ntag_challenge);

  /// Complete NTAG424 3-pass mutual authentication (coroutine).
  ///
  /// Calls the /api/completeTagAuth Firebase endpoint.
  ///
  /// @param cx Coroutine context for suspension
  /// @param auth_id Authentication ID from AuthenticateTagResponse
  /// @param encrypted_tag_response Encrypted Part 3 response from tag
  /// @return CompleteTagAuthResponse or error status
  [[nodiscard]] pw::async2::Coro<pw::Result<CompleteTagAuthResponse>>
  CompleteTagAuth(pw::async2::CoroContext& cx,
                  const FirebaseId& auth_id,
                  pw::ConstByteSpan encrypted_tag_response);

  /// Get the channel ID.
  uint32_t channel_id() const { return channel_id_; }

 private:
  // Type alias for the Forward RPC call handle
  using ForwardCall =
      pw::rpc::PwpbUnaryReceiver<maco::gateway::pwpb::ForwardResponse::Message>;

  pw::rpc::Client& rpc_client_;
  uint32_t channel_id_;

  // Value providers for async results - one per method
  // These bridge the callback-based RPC to awaitable futures
  pw::async2::ValueProvider<pw::Result<TerminalCheckinResponse>>
      terminal_checkin_provider_;
  pw::async2::ValueProvider<pw::Result<AuthenticateTagResponse>>
      authenticate_tag_provider_;
  pw::async2::ValueProvider<pw::Result<CompleteTagAuthResponse>>
      complete_tag_auth_provider_;

  // RPC call handles - must outlive the callbacks
  ForwardCall terminal_checkin_call_;
  ForwardCall authenticate_tag_call_;
  ForwardCall complete_tag_auth_call_;
};

}  // namespace maco::firebase
