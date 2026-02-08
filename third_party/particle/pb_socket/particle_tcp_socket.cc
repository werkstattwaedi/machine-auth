// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "pb_socket"

#include "pb_socket/particle_tcp_socket.h"

#include <atomic>
#include <cerrno>
#include <cstring>

#include "concurrent_hal.h"

#include "inet_hal_posix.h"
#include "netdb_hal.h"
#include "pw_log/log.h"
#include "pw_sync/binary_semaphore.h"
#include "socket_hal_posix.h"

namespace pb::socket {
namespace {

// ============================================================================
// Socket Worker Thread
// ============================================================================
//
// All socket operations are executed on a dedicated thread to avoid deadlocks
// between the calling thread (e.g., pw_rpc handlers) and Particle's system
// thread. Both compete for LwIP's lock_tcpip_core mutex.

enum class SocketOp {
  kConnect,
  kDisconnect,
  kSend,
  kRecv,
};

struct SocketRequest {
  SocketOp op;

  // For Connect
  const char* host;
  uint16_t port;
  uint32_t connect_timeout_ms;
  uint32_t read_timeout_ms;

  // For Send
  const void* send_data;
  size_t send_size;

  // For Recv
  void* recv_buffer;
  size_t recv_size;

  // Input/output state (caller provides current values, socket thread updates)
  int socket_fd;
  TcpState state;
  int last_error;

  // Result
  ssize_t result;
  int error_code;

  // Completion signal
  pw::sync::BinarySemaphore* done;
};

// Global queue for socket requests (holds pointers to SocketRequest)
os_queue_t g_socket_queue = nullptr;
os_thread_t g_socket_thread = nullptr;
std::atomic<bool> g_socket_thread_started{false};
std::atomic<bool> g_socket_thread_init_in_progress{false};

void SocketThreadMain(void* /*arg*/) {
  PW_LOG_INFO("Socket worker thread started");

  while (true) {
    SocketRequest* req = nullptr;
    PW_LOG_DEBUG("SocketThread: waiting for request...");
    if (os_queue_take(g_socket_queue, &req, CONCURRENT_WAIT_FOREVER, nullptr) !=
        0) {
      PW_LOG_WARN("SocketThread: queue take failed");
      continue;
    }
    if (req == nullptr) {
      PW_LOG_WARN("SocketThread: got null request");
      continue;
    }
    PW_LOG_DEBUG("SocketThread: got request op=%d fd=%d",
                 static_cast<int>(req->op), req->socket_fd);

    switch (req->op) {
      case SocketOp::kConnect: {
        PW_LOG_DEBUG("SocketThread: Connect to %s:%u", req->host, req->port);

        // Close existing socket if any
        if (req->socket_fd >= 0) {
          sock_close(req->socket_fd);
          req->socket_fd = -1;
        }

        // Create socket
        req->socket_fd = sock_socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (req->socket_fd < 0) {
          req->error_code = errno;
          req->result = -1;
          req->state = TcpState::kError;
          req->last_error = req->error_code;
          PW_LOG_ERROR("sock_socket failed: %d", req->error_code);
          req->done->release();
          break;
        }

        // Set keepalive
        int flag = 1;
        sock_setsockopt(req->socket_fd, SOL_SOCKET, SO_KEEPALIVE, &flag,
                        sizeof(flag));

        // Set read timeout if specified
        if (req->read_timeout_ms > 0) {
          struct timeval tv;
          tv.tv_sec = req->read_timeout_ms / 1000;
          tv.tv_usec = (req->read_timeout_ms % 1000) * 1000;
          sock_setsockopt(req->socket_fd, SOL_SOCKET, SO_RCVTIMEO, &tv,
                          sizeof(tv));
        }

        // Resolve address
        struct sockaddr_in server_addr;
        std::memset(&server_addr, 0, sizeof(server_addr));
        server_addr.sin_family = AF_INET;
        server_addr.sin_port = inet_htons(req->port);

        if (inet_inet_pton(AF_INET, req->host, &server_addr.sin_addr) != 1) {
          struct addrinfo hints;
          struct addrinfo* result = nullptr;
          std::memset(&hints, 0, sizeof(hints));
          hints.ai_family = AF_INET;
          hints.ai_socktype = SOCK_STREAM;

          int err = netdb_getaddrinfo(req->host, nullptr, &hints, &result);
          if (err != 0 || result == nullptr) {
            req->error_code = err;
            req->result = -1;
            sock_close(req->socket_fd);
            req->socket_fd = -1;
            req->state = TcpState::kError;
            req->last_error = err;
            PW_LOG_ERROR("getaddrinfo failed: %d", err);
            req->done->release();
            break;
          }
          auto* addr = reinterpret_cast<struct sockaddr_in*>(result->ai_addr);
          server_addr.sin_addr = addr->sin_addr;
          netdb_freeaddrinfo(result);
        }

        // Non-blocking connect with timeout
        int flags = sock_fcntl(req->socket_fd, F_GETFL, 0);
        sock_fcntl(req->socket_fd, F_SETFL, flags | O_NONBLOCK);

        int ret = sock_connect(
            req->socket_fd, reinterpret_cast<struct sockaddr*>(&server_addr),
            sizeof(server_addr));

        if (ret < 0 && errno != EINPROGRESS) {
          req->error_code = errno;
          req->result = -1;
          sock_close(req->socket_fd);
          req->socket_fd = -1;
          req->state = TcpState::kError;
          req->last_error = req->error_code;
          PW_LOG_ERROR("sock_connect failed: %d", req->error_code);
          req->done->release();
          break;
        }

        // Poll for connection
        struct pollfd pfd;
        pfd.fd = req->socket_fd;
        pfd.events = POLLOUT;
        pfd.revents = 0;

        ret = sock_poll(&pfd, 1, static_cast<int>(req->connect_timeout_ms));
        if (ret <= 0) {
          req->error_code = (ret == 0) ? ETIMEDOUT : errno;
          req->result = -1;
          sock_close(req->socket_fd);
          req->socket_fd = -1;
          req->state = TcpState::kError;
          req->last_error = req->error_code;
          PW_LOG_ERROR("sock_poll timeout/error: %d", req->error_code);
          req->done->release();
          break;
        }

        // Check socket error
        int socket_error = 0;
        socklen_t len = sizeof(socket_error);
        sock_getsockopt(req->socket_fd, SOL_SOCKET, SO_ERROR, &socket_error,
                        &len);
        if (socket_error != 0) {
          req->error_code = socket_error;
          req->result = -1;
          sock_close(req->socket_fd);
          req->socket_fd = -1;
          req->state = TcpState::kError;
          req->last_error = socket_error;
          PW_LOG_ERROR("Connection error: %d", socket_error);
          req->done->release();
          break;
        }

        // Restore blocking mode
        sock_fcntl(req->socket_fd, F_SETFL, flags);

        req->state = TcpState::kConnected;
        req->last_error = 0;
        req->result = 0;
        req->error_code = 0;
        PW_LOG_INFO("Connected to %s:%u (fd=%d)", req->host, req->port,
                    req->socket_fd);
        req->done->release();
        break;
      }

      case SocketOp::kDisconnect: {
        PW_LOG_DEBUG("SocketThread: Disconnect (fd=%d)", req->socket_fd);
        if (req->socket_fd >= 0) {
          sock_shutdown(req->socket_fd, SHUT_RDWR);
          sock_close(req->socket_fd);
          req->socket_fd = -1;
        }
        req->state = TcpState::kDisconnected;
        req->last_error = 0;
        req->result = 0;
        req->error_code = 0;
        req->done->release();
        break;
      }

      case SocketOp::kSend: {
        PW_LOG_DEBUG("SocketThread: Send %zu bytes (fd=%d)", req->send_size,
                     req->socket_fd);
        if (req->state != TcpState::kConnected || req->socket_fd < 0) {
          req->result = -1;
          req->error_code = ENOTCONN;
          req->last_error = ENOTCONN;
          PW_LOG_WARN("SocketThread: Send failed - not connected");
          req->done->release();
          break;
        }

        // Loop to handle partial writes. sock_send with MSG_DONTWAIT may
        // only send part of the data if the send buffer is full. We poll
        // for writability and retry to ensure the entire payload is sent,
        // which is critical for HDLC frame integrity.
        const auto* data_ptr =
            static_cast<const uint8_t*>(req->send_data);
        size_t remaining = req->send_size;
        bool send_error = false;

        while (remaining > 0) {
          ssize_t sent =
              sock_send(req->socket_fd, data_ptr, remaining, MSG_DONTWAIT);

          if (sent > 0) {
            data_ptr += sent;
            remaining -= static_cast<size_t>(sent);
            continue;
          }

          if (sent < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            // Send buffer full — wait for writability then retry
            struct pollfd pfd;
            pfd.fd = req->socket_fd;
            pfd.events = POLLOUT;
            pfd.revents = 0;
            int poll_ret = sock_poll(&pfd, 1, 5000);
            if (poll_ret <= 0) {
              req->error_code = (poll_ret == 0) ? ETIMEDOUT : errno;
              req->result = -1;
              req->last_error = req->error_code;
              req->state = TcpState::kError;
              send_error = true;
              break;
            }
            continue;
          }

          // Real send error
          req->error_code = errno;
          req->result = -1;
          req->last_error = errno;
          req->state = TcpState::kError;
          send_error = true;
          break;
        }

        if (!send_error) {
          req->result = static_cast<ssize_t>(req->send_size);
          req->error_code = 0;
        }
        req->done->release();
        break;
      }

      case SocketOp::kRecv: {
        if (req->state != TcpState::kConnected || req->socket_fd < 0) {
          req->result = -1;
          req->error_code = ENOTCONN;
          req->last_error = ENOTCONN;
          PW_LOG_WARN("SocketThread: Recv failed - not connected");
          req->done->release();
          break;
        }

        // Use poll() to check socket state before recv.
        // LwIP's recv with MSG_DONTWAIT may return 0 spuriously on a
        // freshly connected socket. poll() gives a reliable indication
        // of whether data is available vs connection closed.
        struct pollfd pfd;
        pfd.fd = req->socket_fd;
        pfd.events = POLLIN;
        pfd.revents = 0;

        int poll_ret = sock_poll(&pfd, 1, 0);

        if (poll_ret == 0) {
          // No events — no data and connection still alive
          req->result = -1;
          req->error_code = EAGAIN;
          req->done->release();
          break;
        }

        if (poll_ret < 0) {
          req->error_code = errno;
          req->result = -1;
          req->last_error = errno;
          req->state = TcpState::kError;
          PW_LOG_WARN("SocketThread: poll error %d (fd=%d)", errno,
                      req->socket_fd);
          req->done->release();
          break;
        }

        // poll_ret > 0: check what happened
        if (pfd.revents & (POLLHUP | POLLERR | POLLNVAL)) {
          PW_LOG_WARN("SocketThread: poll revents=0x%x (fd=%d) — closed",
                      static_cast<unsigned>(pfd.revents), req->socket_fd);
          req->result = 0;
          req->error_code = 0;
          req->state = TcpState::kDisconnected;
          req->done->release();
          break;
        }

        // POLLIN: data available, do the recv
        ssize_t received = sock_recv(req->socket_fd, req->recv_buffer,
                                     req->recv_size, MSG_DONTWAIT);

        if (received < 0) {
          req->error_code = errno;
          req->result = -1;
          req->last_error = errno;
          if (errno != EAGAIN && errno != EWOULDBLOCK) {
            req->state = TcpState::kError;
          }
        } else if (received == 0) {
          // Connection closed by peer
          req->result = 0;
          req->error_code = 0;
          req->state = TcpState::kDisconnected;
        } else {
          req->result = received;
          req->error_code = 0;
        }
        req->done->release();
        break;
      }
    }
  }
}

/// Initialize socket thread with proper synchronization.
/// Returns true if thread is ready, false on initialization failure.
bool EnsureSocketThreadStarted() {
  // Fast path: already initialized
  if (g_socket_thread_started.load(std::memory_order_acquire)) {
    return true;
  }

  // Try to claim initialization
  bool expected = false;
  if (!g_socket_thread_init_in_progress.compare_exchange_strong(
          expected, true, std::memory_order_acq_rel)) {
    // Another thread is initializing, spin until done
    while (!g_socket_thread_started.load(std::memory_order_acquire)) {
      // Small delay to avoid busy spinning
      os_thread_yield();
    }
    return true;
  }

  // We claimed initialization, do it
  // Create request queue (holds up to 4 request pointers)
  int ret = os_queue_create(&g_socket_queue, sizeof(SocketRequest*), 4, nullptr);
  if (ret != 0) {
    PW_LOG_ERROR("os_queue_create failed: %d", ret);
    g_socket_thread_init_in_progress.store(false, std::memory_order_release);
    return false;
  }

  // Create socket thread with 4KB stack
  ret = os_thread_create(&g_socket_thread, "socket", OS_THREAD_PRIORITY_DEFAULT,
                         SocketThreadMain, nullptr, 4096);
  if (ret != 0) {
    PW_LOG_ERROR("os_thread_create failed: %d", ret);
    // Clean up queue on failure
    // Note: Device OS doesn't have os_queue_destroy, so we leak it
    g_socket_thread_init_in_progress.store(false, std::memory_order_release);
    return false;
  }

  g_socket_thread_started.store(true, std::memory_order_release);
  return true;
}

}  // namespace

// ============================================================================
// ParticleTcpSocket Implementation
// ============================================================================

ParticleTcpSocket::ParticleTcpSocket(const TcpConfig& config)
    : config_(config) {}

ParticleTcpSocket::~ParticleTcpSocket() { Disconnect(); }

pw::Status ParticleTcpSocket::Connect() {
  TcpState current_state = state_.load(std::memory_order_acquire);
  if (current_state == TcpState::kConnected) {
    return pw::Status::FailedPrecondition();
  }

  if (!EnsureSocketThreadStarted()) {
    last_error_.store(ENOMEM, std::memory_order_release);
    return pw::Status::Internal();
  }

  state_.store(TcpState::kConnecting, std::memory_order_release);

  // Queue connect request to socket thread
  pw::sync::BinarySemaphore done;
  SocketRequest req{};
  req.op = SocketOp::kConnect;
  req.socket_fd = socket_fd_.load(std::memory_order_acquire);
  req.state = state_.load(std::memory_order_acquire);
  req.last_error = last_error_.load(std::memory_order_acquire);
  req.host = config_.host;
  req.port = config_.port;
  req.connect_timeout_ms = config_.connect_timeout_ms;
  req.read_timeout_ms = config_.read_timeout_ms;
  req.done = &done;

  PW_LOG_INFO("Connect: %s:%u", config_.host, config_.port);
  SocketRequest* req_ptr = &req;
  os_queue_put(g_socket_queue, &req_ptr, CONCURRENT_WAIT_FOREVER, nullptr);
  done.acquire();

  // Store results atomically
  socket_fd_.store(req.socket_fd, std::memory_order_release);
  state_.store(req.state, std::memory_order_release);
  last_error_.store(req.last_error, std::memory_order_release);

  if (req.result < 0) {
    if (req.error_code == ETIMEDOUT) {
      return pw::Status::DeadlineExceeded();
    }
    return pw::Status::Unavailable();
  }

  return pw::OkStatus();
}

void ParticleTcpSocket::Disconnect() {
  int fd = socket_fd_.load(std::memory_order_acquire);
  TcpState current_state = state_.load(std::memory_order_acquire);
  if (fd < 0 && current_state == TcpState::kDisconnected) {
    return;
  }

  if (!EnsureSocketThreadStarted()) {
    // Can't start thread, just mark as disconnected
    socket_fd_.store(-1, std::memory_order_release);
    state_.store(TcpState::kDisconnected, std::memory_order_release);
    return;
  }

  pw::sync::BinarySemaphore done;
  SocketRequest req{};
  req.op = SocketOp::kDisconnect;
  req.socket_fd = fd;
  req.state = current_state;
  req.last_error = last_error_.load(std::memory_order_acquire);
  req.done = &done;

  SocketRequest* req_ptr = &req;
  os_queue_put(g_socket_queue, &req_ptr, CONCURRENT_WAIT_FOREVER, nullptr);
  done.acquire();

  // Store results atomically
  socket_fd_.store(req.socket_fd, std::memory_order_release);
  state_.store(req.state, std::memory_order_release);
  last_error_.store(req.last_error, std::memory_order_release);
}

bool ParticleTcpSocket::IsConnected() const {
  return state_.load(std::memory_order_acquire) == TcpState::kConnected &&
         socket_fd_.load(std::memory_order_acquire) >= 0;
}

pw::StatusWithSize ParticleTcpSocket::Read(pw::ByteSpan dest) {
  PW_LOG_DEBUG("Read: checking connection state");
  if (!IsConnected()) {
    PW_LOG_WARN("Read: not connected");
    last_error_.store(ENOTCONN, std::memory_order_release);
    return pw::StatusWithSize::FailedPrecondition();
  }

  if (!EnsureSocketThreadStarted()) {
    PW_LOG_ERROR("Read: socket thread not started");
    last_error_.store(ENOMEM, std::memory_order_release);
    return pw::StatusWithSize::Internal();
  }

  pw::sync::BinarySemaphore done;
  SocketRequest req{};
  req.op = SocketOp::kRecv;
  req.socket_fd = socket_fd_.load(std::memory_order_acquire);
  req.state = state_.load(std::memory_order_acquire);
  req.last_error = last_error_.load(std::memory_order_acquire);
  req.recv_buffer = dest.data();
  req.recv_size = dest.size();
  req.done = &done;

  PW_LOG_DEBUG("Read: queuing recv request fd=%d size=%zu", req.socket_fd,
               req.recv_size);
  SocketRequest* req_ptr = &req;
  os_queue_put(g_socket_queue, &req_ptr, CONCURRENT_WAIT_FOREVER, nullptr);
  PW_LOG_DEBUG("Read: waiting for completion");
  done.acquire();
  PW_LOG_DEBUG("Read: completed result=%zd err=%d", req.result, req.error_code);

  // Store results atomically
  state_.store(req.state, std::memory_order_release);
  last_error_.store(req.last_error, std::memory_order_release);

  if (req.result < 0) {
    if (req.error_code == EAGAIN || req.error_code == EWOULDBLOCK) {
      return pw::StatusWithSize(0);
    }
    return pw::StatusWithSize::Internal();
  }

  if (req.result == 0) {
    // Connection closed by peer
    return pw::StatusWithSize::OutOfRange();
  }

  return pw::StatusWithSize(static_cast<size_t>(req.result));
}

pw::Status ParticleTcpSocket::Write(pw::ConstByteSpan data) {
  if (!IsConnected()) {
    last_error_.store(ENOTCONN, std::memory_order_release);
    return pw::Status::FailedPrecondition();
  }

  if (!EnsureSocketThreadStarted()) {
    last_error_.store(ENOMEM, std::memory_order_release);
    return pw::Status::Internal();
  }

  pw::sync::BinarySemaphore done;
  SocketRequest req{};
  req.op = SocketOp::kSend;
  req.socket_fd = socket_fd_.load(std::memory_order_acquire);
  req.state = state_.load(std::memory_order_acquire);
  req.last_error = last_error_.load(std::memory_order_acquire);
  req.send_data = data.data();
  req.send_size = data.size();
  req.done = &done;

  SocketRequest* req_ptr = &req;
  os_queue_put(g_socket_queue, &req_ptr, CONCURRENT_WAIT_FOREVER, nullptr);
  done.acquire();

  // Store results atomically
  state_.store(req.state, std::memory_order_release);
  last_error_.store(req.last_error, std::memory_order_release);

  if (req.result < 0) {
    return pw::Status::Internal();
  }

  return pw::OkStatus();
}

}  // namespace pb::socket
