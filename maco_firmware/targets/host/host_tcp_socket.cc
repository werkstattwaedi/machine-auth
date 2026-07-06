// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/targets/host/host_tcp_socket.h"

#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>

#define PW_LOG_MODULE_NAME "XSEN"
#include "pw_log/log.h"

namespace maco::host {

pw::Status HostTcpSocket::Connect() {
  if (fd_ >= 0) {
    return pw::OkStatus();
  }

  char port_str[8];
  std::snprintf(port_str, sizeof(port_str), "%u",
                static_cast<unsigned>(port_));

  addrinfo hints{};
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_STREAM;
  addrinfo* result = nullptr;
  // getaddrinfo reports via its return code, not errno.
  int gai = getaddrinfo(host_.c_str(), port_str, &hints, &result);
  if (gai != 0 || result == nullptr) {
    last_error_ = gai;
    state_ = pb::socket::TcpState::kError;
    return pw::Status::Unavailable();
  }

  int fd = ::socket(result->ai_family, result->ai_socktype,
                    result->ai_protocol);
  if (fd < 0) {
    last_error_ = errno;
    freeaddrinfo(result);
    state_ = pb::socket::TcpState::kError;
    return pw::Status::Internal();
  }

  if (::connect(fd, result->ai_addr, result->ai_addrlen) != 0) {
    last_error_ = errno;
    ::close(fd);
    freeaddrinfo(result);
    state_ = pb::socket::TcpState::kError;
    return pw::Status::Unavailable();
  }
  freeaddrinfo(result);

  // Non-blocking reads: Read() returns size 0 instead of blocking.
  int flags = ::fcntl(fd, F_GETFL, 0);
  ::fcntl(fd, F_SETFL, flags | O_NONBLOCK);

  fd_ = fd;
  state_ = pb::socket::TcpState::kConnected;
  return pw::OkStatus();
}

void HostTcpSocket::Disconnect() {
  if (fd_ >= 0) {
    ::close(fd_);
    fd_ = -1;
  }
  state_ = pb::socket::TcpState::kDisconnected;
}

pw::StatusWithSize HostTcpSocket::Read(pw::ByteSpan dest) {
  if (fd_ < 0) {
    return pw::StatusWithSize::FailedPrecondition();
  }
  ssize_t n = ::recv(fd_, dest.data(), dest.size(), MSG_DONTWAIT);
  if (n > 0) {
    return pw::StatusWithSize(static_cast<size_t>(n));
  }
  if (n == 0) {
    // Peer closed the connection.
    return pw::StatusWithSize(pw::Status::OutOfRange(), 0);
  }
  if (errno == EAGAIN || errno == EWOULDBLOCK) {
    return pw::StatusWithSize(0);  // No data available yet.
  }
  last_error_ = errno;
  return pw::StatusWithSize(pw::Status::Internal(), 0);
}

pw::Status HostTcpSocket::Write(pw::ConstByteSpan data) {
  if (fd_ < 0) {
    return pw::Status::FailedPrecondition();
  }
  size_t total = 0;
  while (total < data.size()) {
    ssize_t n = ::send(fd_, data.data() + total, data.size() - total, 0);
    if (n < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) {
        // Non-blocking fd, send buffer momentarily full — retry.
        continue;
      }
      last_error_ = errno;
      return pw::Status::Internal();
    }
    if (n == 0) {
      return pw::Status::Internal();
    }
    total += static_cast<size_t>(n);
  }
  return pw::OkStatus();
}

}  // namespace maco::host
