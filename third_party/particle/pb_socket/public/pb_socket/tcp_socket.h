// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file tcp_socket.h
/// @brief Abstract TCP socket interface with direct virtual methods.
///
/// Unlike pw::stream, Read/Write are direct virtual methods - no non-virtual
/// wrapper calling virtual DoRead/DoWrite. This sidesteps a virtual dispatch
/// issue on ARM that causes crashes when DoWrite() accesses the Device OS
/// socket dynalib.
///
/// For pw::stream compatibility (e.g., pw_rpc), use TcpSocketStreamAdapter.

#include <cstdint>

#include "pw_bytes/span.h"
#include "pw_status/status.h"
#include "pw_status/status_with_size.h"

namespace pb::socket {

/// TCP connection state.
enum class TcpState {
  kDisconnected,
  kConnecting,
  kConnected,
  kError,
};

/// Configuration for TCP socket connection.
struct TcpConfig {
  /// Server IP address (IPv4 in dotted decimal or hostname)
  const char* host = nullptr;
  /// Server port
  uint16_t port = 0;
  /// Connection timeout in milliseconds
  uint32_t connect_timeout_ms = 10000;
  /// Read timeout in milliseconds (0 = non-blocking)
  uint32_t read_timeout_ms = 0;
};

/// Abstract TCP socket interface.
///
/// Provides connection management and data transfer operations.
/// Read/Write are DIRECT virtual methods (not the pw::stream DoXxx pattern)
/// to avoid a problematic virtual dispatch pattern on ARM.
///
/// Usage:
/// @code
///   pb::socket::TcpConfig config{
///       .host = "192.168.1.100",
///       .port = 5000,
///   };
///   pb::socket::ParticleTcpSocket socket(config);
///
///   if (socket.Connect().ok()) {
///     socket.Write(pw::as_bytes(pw::span("hello")));
///     std::byte buffer[64];
///     auto result = socket.Read(buffer);
///   }
///   socket.Disconnect();
/// @endcode
class TcpSocket {
 public:
  virtual ~TcpSocket() = default;

  /// Connect to the configured server.
  /// @return OkStatus on success, Unavailable if already connected,
  ///         DeadlineExceeded on timeout, FailedPrecondition on error
  virtual pw::Status Connect() = 0;

  /// Disconnect from the server.
  virtual void Disconnect() = 0;

  /// Check if currently connected.
  virtual bool IsConnected() const = 0;

  /// Get current connection state.
  virtual TcpState state() const = 0;

  /// Get last error code (platform-specific).
  virtual int last_error() const = 0;

  /// Read data from the socket.
  ///
  /// This is a DIRECT virtual method, not the pw::stream DoRead pattern.
  ///
  /// @param dest Buffer to read into
  /// @return StatusWithSize with bytes read, or error status:
  ///         - FailedPrecondition if not connected
  ///         - Internal on read error
  ///         - OutOfRange if connection closed by peer
  virtual pw::StatusWithSize Read(pw::ByteSpan dest) = 0;

  /// Write data to the socket.
  ///
  /// This is a DIRECT virtual method, not the pw::stream DoWrite pattern.
  ///
  /// @param data Data to write
  /// @return OkStatus on success, or error status:
  ///         - FailedPrecondition if not connected
  ///         - ResourceExhausted if would block or partial write
  ///         - Internal on write error
  virtual pw::Status Write(pw::ConstByteSpan data) = 0;
};

}  // namespace pb::socket
