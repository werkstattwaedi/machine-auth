// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file firebase_client.h
/// @brief Firebase client for typed RPC calls via MACO Gateway.
///
/// This module provides typed wrappers around the generic Forward RPC
/// to Firebase Cloud Functions. Each Firebase endpoint is exposed as a
/// strongly-typed method that handles serialization and deserialization.
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
///   // Make async RPC calls
///   auto future = firebase.StartSession(tag_uid);
///   // ... await future in your async task ...
/// @endcode

#include <cstdint>

#include "common.pwpb.h"
#include "firebase_rpc/session.pwpb.h"
#include "gateway/gateway_service.pwpb.h"
#include "gateway/gateway_service.rpc.pwpb.h"
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

// Type aliases for Firebase RPC response types
using StartSessionResponse =
    maco::proto::firebase_rpc::pwpb::StartSessionResponse::Message;
using AuthenticateNewSessionResponse =
    maco::proto::firebase_rpc::pwpb::AuthenticateNewSessionResponse::Message;
using CompleteAuthenticationResponse =
    maco::proto::firebase_rpc::pwpb::CompleteAuthenticationResponse::Message;

/// Future type for StartSession.
using StartSessionFuture =
    pw::async2::ValueFuture<pw::Result<StartSessionResponse>>;

/// Future type for AuthenticateNewSession.
using AuthenticateNewSessionFuture =
    pw::async2::ValueFuture<pw::Result<AuthenticateNewSessionResponse>>;

/// Future type for CompleteAuthentication.
using CompleteAuthenticationFuture =
    pw::async2::ValueFuture<pw::Result<CompleteAuthenticationResponse>>;

/// Firebase client for making typed RPC calls through the gateway.
///
/// The client wraps the generic Forward RPC and provides typed methods for
/// each Firebase endpoint. It handles:
/// - Serializing request protos to bytes
/// - Calling the gateway's Forward RPC asynchronously
/// - Deserializing response protos from bytes
///
/// Usage:
/// @code
///   FirebaseClient client(rpc_client, channel_id);
///
///   auto future = client.StartSession(tag_uid);
///   // Await the future in your async task...
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

  /// Start a session with a tag (async).
  ///
  /// Calls the /api/startSession Firebase endpoint.
  ///
  /// @param tag_uid The 7-byte NTAG UID
  /// @return Future that resolves to StartSessionResponse or error status
  StartSessionFuture StartSession(const TagUid& tag_uid);

  /// Initiate authentication for a new session (async).
  ///
  /// Calls the /api/authenticateNewSession Firebase endpoint.
  ///
  /// @param tag_uid The 7-byte NTAG UID
  /// @param ntag_challenge Challenge from the NTAG (RndB)
  /// @return Future that resolves to AuthenticateNewSessionResponse or error
  AuthenticateNewSessionFuture AuthenticateNewSession(
      const TagUid& tag_uid, pw::ConstByteSpan ntag_challenge);

  /// Complete authentication (async).
  ///
  /// Calls the /api/completeAuthentication Firebase endpoint.
  ///
  /// @param session_id Session ID from AuthenticateNewSession
  /// @param encrypted_ntag_response NTAG's encrypted response
  /// @return Future that resolves to CompleteAuthenticationResponse or error
  CompleteAuthenticationFuture CompleteAuthentication(
      const FirebaseId& session_id, pw::ConstByteSpan encrypted_ntag_response);

  /// Get the channel ID.
  uint32_t channel_id() const { return channel_id_; }

 private:
  // Type alias for the Forward RPC call handle
  using ForwardCall = pw::rpc::PwpbUnaryReceiver<
      maco::gateway::pwpb::ForwardResponse::Message>;

  pw::rpc::Client& rpc_client_;
  uint32_t channel_id_;

  // Value providers for async results - one per method
  pw::async2::ValueProvider<pw::Result<StartSessionResponse>>
      start_session_provider_;
  pw::async2::ValueProvider<pw::Result<AuthenticateNewSessionResponse>>
      auth_new_session_provider_;
  pw::async2::ValueProvider<pw::Result<CompleteAuthenticationResponse>>
      complete_auth_provider_;

  // RPC call handles - must outlive the callbacks
  ForwardCall start_session_call_;
  ForwardCall auth_new_session_call_;
  ForwardCall complete_auth_call_;
};

}  // namespace maco::firebase
