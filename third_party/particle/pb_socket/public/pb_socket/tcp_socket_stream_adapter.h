// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file tcp_socket_stream_adapter.h
/// @brief Adapter to use TcpSocket as pw::stream::ReaderWriter.
///
/// This provides pw::stream compatibility for TcpSocket, enabling use with
/// pw_rpc and pw_hdlc. The DoRead/DoWrite methods simply delegate to the
/// TcpSocket's direct virtual Read/Write methods.
///
/// Note: This adapter still has virtual calls above the socket operations,
/// but the virtual → virtual delegation may work where the pw::stream
/// non-virtual → virtual pattern failed.

#include "pb_socket/tcp_socket.h"
#include "pw_stream/stream.h"

namespace pb::socket {

/// Adapter to use TcpSocket as pw::stream::ReaderWriter.
///
/// Usage:
/// @code
///   ParticleTcpSocket socket(config);
///   TcpSocketStreamAdapter stream(socket);
///
///   // Use stream with pw_hdlc
///   pw::hdlc::WriteUIFrame(address, data, stream);
/// @endcode
class TcpSocketStreamAdapter : public pw::stream::NonSeekableReaderWriter {
 public:
  /// Construct adapter wrapping a TcpSocket.
  explicit TcpSocketStreamAdapter(TcpSocket& socket) : socket_(socket) {}

 private:
  pw::StatusWithSize DoRead(pw::ByteSpan dest) override {
    return socket_.Read(dest);
  }

  pw::Status DoWrite(pw::ConstByteSpan data) override {
    return socket_.Write(data);
  }

  TcpSocket& socket_;
};

}  // namespace pb::socket
