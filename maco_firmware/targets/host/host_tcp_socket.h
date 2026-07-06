// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file host_tcp_socket.h
/// @brief POSIX TcpSocket for the host simulator.
///
/// Lets the simulator poll a real LAN endpoint (e.g. a stub xTool HTTP
/// server) so the machine-sensor path can be exercised end-to-end without
/// hardware. Non-blocking reads mirror ParticleTcpSocket's contract.

#include <cstdint>
#include <string>

#include "pb_socket/tcp_socket.h"

namespace maco::host {

class HostTcpSocket : public pb::socket::TcpSocket {
 public:
  HostTcpSocket(std::string host, uint16_t port)
      : host_(std::move(host)), port_(port) {}
  ~HostTcpSocket() override { Disconnect(); }

  pw::Status Connect() override;
  void Disconnect() override;
  bool IsConnected() const override { return fd_ >= 0; }
  pb::socket::TcpState state() const override { return state_; }
  int last_error() const override { return last_error_; }
  pw::StatusWithSize Read(pw::ByteSpan dest) override;
  pw::Status Write(pw::ConstByteSpan data) override;

 private:
  std::string host_;
  uint16_t port_;
  int fd_ = -1;
  int last_error_ = 0;
  pb::socket::TcpState state_ = pb::socket::TcpState::kDisconnected;
};

}  // namespace maco::host
