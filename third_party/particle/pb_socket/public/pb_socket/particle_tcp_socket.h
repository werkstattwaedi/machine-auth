// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file particle_tcp_socket.h
/// @brief TCP socket implementation using Particle Device OS sockets.
///
/// This implementation uses a dedicated socket worker thread to avoid deadlocks
/// between the calling thread (e.g., pw_rpc handlers) and Particle's system
/// thread. Both compete for LwIP's lock_tcpip_core mutex, which can cause
/// deadlocks when socket operations are called directly from RPC handlers.
///
/// Architecture:
/// - All sock_* HAL calls are executed on a dedicated socket thread
/// - Public methods queue requests to the socket thread and wait for completion
/// - A global thread/queue is shared by all ParticleTcpSocket instances
///
/// Thread Safety:
/// - Safe to call from any thread (operations are serialized through the queue)
/// - State accessors use atomic variables for thread-safe reads

#include <atomic>

#include "pb_socket/tcp_socket.h"

namespace pb::socket {

/// TCP socket implementation using Particle Device OS sockets.
///
/// Uses a dedicated socket worker thread to avoid deadlocks with Particle's
/// cloud connection. Safe to call from any thread, including RPC handlers.
///
/// Usage:
/// @code
///   pb::socket::TcpConfig config{
///       .host = "192.168.1.100",
///       .port = 5000,
///       .connect_timeout_ms = 10000,
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
class ParticleTcpSocket : public TcpSocket {
 public:
  /// Construct TCP socket with configuration.
  /// The socket worker thread is started lazily on first Connect().
  explicit ParticleTcpSocket(const TcpConfig& config);

  /// Destructor - disconnects if connected.
  ~ParticleTcpSocket() override;

  // Non-copyable, non-movable (socket_fd_ is managed by socket thread)
  ParticleTcpSocket(const ParticleTcpSocket&) = delete;
  ParticleTcpSocket& operator=(const ParticleTcpSocket&) = delete;
  ParticleTcpSocket(ParticleTcpSocket&&) = delete;
  ParticleTcpSocket& operator=(ParticleTcpSocket&&) = delete;

  // TcpSocket interface - all operations are queued to socket thread
  pw::Status Connect() override;
  void Disconnect() override;
  bool IsConnected() const override;
  TcpState state() const override {
    return state_.load(std::memory_order_acquire);
  }
  int last_error() const override {
    return last_error_.load(std::memory_order_acquire);
  }

  pw::StatusWithSize Read(pw::ByteSpan dest) override;
  pw::Status Write(pw::ConstByteSpan data) override;

  /// Direct socket fd access for debugging only.
  int socket_fd() const { return socket_fd_.load(std::memory_order_acquire); }

 private:
  TcpConfig config_;

  // Atomic state variables - modified by socket thread, read by public accessors.
  // Uses memory_order_acquire/release for proper synchronization.
  std::atomic<int> socket_fd_{-1};
  std::atomic<TcpState> state_{TcpState::kDisconnected};
  std::atomic<int> last_error_{0};
};

}  // namespace pb::socket
