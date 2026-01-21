// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/gateway/host_gateway_client.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <array>
#include <cstring>
#include <random>

#include "pb_crypto/pb_crypto.h"
#include "pw_async2/context.h"
#include "pw_async2/poll.h"
#include "pw_async2/task.h"
#include "pw_bytes/endian.h"
#include "pw_hdlc/decoder.h"
#include "pw_hdlc/encoder.h"
#include "pw_rpc/channel.h"
#include "pw_stream/stream.h"

#define PW_LOG_MODULE_NAME "gateway"
#include "pw_log/log.h"

namespace maco::gateway {

namespace {

constexpr uint64_t kHdlcAddress = 1;

/// Generate a random uint64_t for nonce initialization.
/// This prevents nonce reuse across process restarts.
uint64_t GetRandomNonceStart() {
  std::random_device rd;
  std::uniform_int_distribution<uint64_t> dist;
  return dist(rd);
}
constexpr size_t kMaxPayloadSize = 512;
constexpr size_t kDeviceIdSize = 8;
constexpr size_t kNonceSize = 16;
constexpr size_t kTagSize = 16;
constexpr size_t kKeySize = 16;
constexpr size_t kFrameHeaderSize = kDeviceIdSize + kNonceSize;
constexpr size_t kMaxHdlcFrameSize =
    kDeviceIdSize + kNonceSize + kMaxPayloadSize + kTagSize;

/// Simple POSIX TCP stream for host.
class HostTcpStream : public pw::stream::NonSeekableReaderWriter {
 public:
  HostTcpStream(const char* host, uint16_t port, uint32_t connect_timeout_ms,
                uint32_t read_timeout_ms)
      : host_(host),
        port_(port),
        connect_timeout_ms_(connect_timeout_ms),
        read_timeout_ms_(read_timeout_ms) {}

  ~HostTcpStream() override { Disconnect(); }

  pw::Status Connect() {
    if (socket_fd_ >= 0) {
      return pw::Status::FailedPrecondition();
    }

    socket_fd_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (socket_fd_ < 0) {
      PW_LOG_ERROR("Failed to create socket: %d", errno);
      return pw::Status::Internal();
    }

    // Set keepalive
    int flag = 1;
    setsockopt(socket_fd_, SOL_SOCKET, SO_KEEPALIVE, &flag, sizeof(flag));

    // Set read timeout
    if (read_timeout_ms_ > 0) {
      struct timeval tv;
      tv.tv_sec = read_timeout_ms_ / 1000;
      tv.tv_usec = (read_timeout_ms_ % 1000) * 1000;
      setsockopt(socket_fd_, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    }

    // Resolve address
    struct sockaddr_in server_addr;
    std::memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(port_);

    if (inet_pton(AF_INET, host_, &server_addr.sin_addr) != 1) {
      // Try hostname resolution
      struct addrinfo hints;
      struct addrinfo* result = nullptr;
      std::memset(&hints, 0, sizeof(hints));
      hints.ai_family = AF_INET;
      hints.ai_socktype = SOCK_STREAM;

      int err = getaddrinfo(host_, nullptr, &hints, &result);
      if (err != 0 || result == nullptr) {
        PW_LOG_ERROR("Failed to resolve hostname '%s'", host_);
        close(socket_fd_);
        socket_fd_ = -1;
        return pw::Status::NotFound();
      }

      auto* addr = reinterpret_cast<struct sockaddr_in*>(result->ai_addr);
      server_addr.sin_addr = addr->sin_addr;
      freeaddrinfo(result);
    }

    // Non-blocking connect with timeout
    int flags = fcntl(socket_fd_, F_GETFL, 0);
    fcntl(socket_fd_, F_SETFL, flags | O_NONBLOCK);

    int ret = connect(socket_fd_, reinterpret_cast<struct sockaddr*>(&server_addr),
                     sizeof(server_addr));

    if (ret < 0 && errno != EINPROGRESS) {
      PW_LOG_ERROR("Failed to connect: %d", errno);
      close(socket_fd_);
      socket_fd_ = -1;
      return pw::Status::Unavailable();
    }

    // Wait for connection
    struct pollfd pfd;
    pfd.fd = socket_fd_;
    pfd.events = POLLOUT;
    pfd.revents = 0;

    ret = poll(&pfd, 1, static_cast<int>(connect_timeout_ms_));
    if (ret <= 0) {
      PW_LOG_ERROR("Connection timeout");
      close(socket_fd_);
      socket_fd_ = -1;
      return pw::Status::DeadlineExceeded();
    }

    // Check for errors
    int socket_error = 0;
    socklen_t len = sizeof(socket_error);
    getsockopt(socket_fd_, SOL_SOCKET, SO_ERROR, &socket_error, &len);
    if (socket_error != 0) {
      PW_LOG_ERROR("Connection failed: %d", socket_error);
      close(socket_fd_);
      socket_fd_ = -1;
      return pw::Status::Unavailable();
    }

    // Restore blocking mode
    fcntl(socket_fd_, F_SETFL, flags);

    connected_ = true;
    PW_LOG_INFO("Connected to %s:%u", host_, port_);
    return pw::OkStatus();
  }

  void Disconnect() {
    if (socket_fd_ >= 0) {
      shutdown(socket_fd_, SHUT_RDWR);
      close(socket_fd_);
      socket_fd_ = -1;
    }
    connected_ = false;
  }

  bool IsConnected() const { return connected_ && socket_fd_ >= 0; }

  /// Non-blocking read for use by the read task.
  pw::StatusWithSize ReadNonBlocking(pw::ByteSpan dest) {
    if (!IsConnected()) {
      return pw::StatusWithSize::FailedPrecondition();
    }

    // Set non-blocking temporarily
    int flags = fcntl(socket_fd_, F_GETFL, 0);
    fcntl(socket_fd_, F_SETFL, flags | O_NONBLOCK);

    ssize_t bytes_read = recv(socket_fd_, dest.data(), dest.size(), 0);

    // Restore blocking mode
    fcntl(socket_fd_, F_SETFL, flags);

    if (bytes_read < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) {
        return pw::StatusWithSize(0);
      }
      connected_ = false;
      return pw::StatusWithSize::Internal();
    }

    if (bytes_read == 0) {
      connected_ = false;
      return pw::StatusWithSize::OutOfRange();
    }

    return pw::StatusWithSize(static_cast<size_t>(bytes_read));
  }

 private:
  pw::StatusWithSize DoRead(pw::ByteSpan dest) override {
    if (!IsConnected()) {
      return pw::StatusWithSize::FailedPrecondition();
    }

    ssize_t bytes_read = recv(socket_fd_, dest.data(), dest.size(), 0);
    if (bytes_read < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) {
        return pw::StatusWithSize(0);
      }
      connected_ = false;
      return pw::StatusWithSize::Internal();
    }

    if (bytes_read == 0) {
      connected_ = false;
      return pw::StatusWithSize::OutOfRange();
    }

    return pw::StatusWithSize(static_cast<size_t>(bytes_read));
  }

  pw::Status DoWrite(pw::ConstByteSpan data) override {
    if (!IsConnected()) {
      return pw::Status::FailedPrecondition();
    }

    size_t total_sent = 0;
    while (total_sent < data.size()) {
      ssize_t bytes_sent =
          send(socket_fd_, data.data() + total_sent, data.size() - total_sent, 0);
      if (bytes_sent < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
          struct pollfd pfd;
          pfd.fd = socket_fd_;
          pfd.events = POLLOUT;
          int ret = poll(&pfd, 1, 1000);
          if (ret <= 0) {
            connected_ = false;
            return pw::Status::DeadlineExceeded();
          }
          continue;
        }
        connected_ = false;
        return pw::Status::Internal();
      }
      total_sent += static_cast<size_t>(bytes_sent);
    }
    return pw::OkStatus();
  }

  const char* host_;
  uint16_t port_;
  uint32_t connect_timeout_ms_;
  uint32_t read_timeout_ms_;
  int socket_fd_ = -1;
  bool connected_ = false;
};

/// ASCON channel output for host.
class AsconChannelOutput : public pw::rpc::ChannelOutput {
 public:
  AsconChannelOutput(HostTcpStream& tcp_stream, pw::ConstByteSpan key,
                     uint64_t device_id, const char* channel_name)
      : ChannelOutput(channel_name),
        tcp_stream_(tcp_stream),
        device_id_(device_id) {
    if (key.size() >= kKeySize) {
      std::copy_n(key.begin(), kKeySize, key_.begin());
    } else {
      std::fill(key_.begin(), key_.end(), std::byte{0});
      std::copy(key.begin(), key.end(), key_.begin());
    }
  }

  pw::Status Send(pw::span<const std::byte> buffer) override {
    if (buffer.size() > kMaxPayloadSize) {
      return pw::Status::ResourceExhausted();
    }

    pw::Status status = EnsureConnected();
    if (!status.ok()) {
      return status;
    }

    const size_t frame_size =
        kDeviceIdSize + kNonceSize + buffer.size() + kTagSize;

    std::array<std::byte,
               kDeviceIdSize + kNonceSize + kMaxPayloadSize + kTagSize>
        frame_buffer;

    auto device_id_bytes = pw::bytes::CopyInOrder(pw::endian::big, device_id_);
    std::copy(device_id_bytes.begin(), device_id_bytes.end(), frame_buffer.begin());

    auto nonce = BuildNonce();
    std::copy(nonce.begin(), nonce.end(), frame_buffer.begin() + kDeviceIdSize);

    pw::ByteSpan ciphertext(frame_buffer.data() + kFrameHeaderSize,
                            buffer.size());
    pw::ByteSpan tag(frame_buffer.data() + kFrameHeaderSize + buffer.size(),
                     kTagSize);

    pw::ConstByteSpan associated_data(frame_buffer.data(), kFrameHeaderSize);

    status = pb::crypto::AsconAead128Encrypt(key_, nonce, associated_data,
                                             buffer, ciphertext, tag);
    if (!status.ok()) {
      return status;
    }

    ++nonce_counter_;

    pw::ConstByteSpan frame(frame_buffer.data(), frame_size);
    return SendFrame(frame);
  }

  size_t MaximumTransmissionUnit() override { return kMaxPayloadSize; }

  pw::Status EnsureConnected() {
    if (tcp_stream_.IsConnected()) {
      return pw::OkStatus();
    }
    return tcp_stream_.Connect();
  }

 private:
  pw::Status SendFrame(pw::ConstByteSpan frame) {
    pw::Status status =
        pw::hdlc::WriteUIFrame(kHdlcAddress, frame, tcp_stream_);
    if (status.ok()) {
      return pw::OkStatus();
    }

    tcp_stream_.Disconnect();
    status = EnsureConnected();
    if (!status.ok()) {
      return status;
    }

    status = pw::hdlc::WriteUIFrame(kHdlcAddress, frame, tcp_stream_);
    if (!status.ok()) {
      tcp_stream_.Disconnect();
    }
    return status;
  }

  std::array<std::byte, kNonceSize> BuildNonce() const {
    std::array<std::byte, kNonceSize> nonce{};
    auto device_id_bytes = pw::bytes::CopyInOrder(pw::endian::big, device_id_);
    auto counter_bytes = pw::bytes::CopyInOrder(pw::endian::big, nonce_counter_);
    std::copy(device_id_bytes.begin(), device_id_bytes.end(), nonce.begin());
    std::copy(counter_bytes.begin(), counter_bytes.end(), nonce.begin() + 8);
    return nonce;
  }

  HostTcpStream& tcp_stream_;
  std::array<std::byte, kKeySize> key_;
  uint64_t device_id_;
  uint64_t nonce_counter_ = GetRandomNonceStart();
};

}  // namespace

struct HostGatewayClient::Impl {
  Impl(const GatewayConfig& config)
      : tcp_stream(config.host, config.port, config.connect_timeout_ms,
                   config.read_timeout_ms),
        channel_output(tcp_stream, pw::ConstByteSpan(config.key, kKeySize),
                       config.device_id, "gateway"),
        channels{pw::rpc::Channel::Create<1>(&channel_output)},
        rpc_client(channels),
        device_id_(config.device_id) {
    // Copy key for decryption
    if (config.key != nullptr) {
      std::copy_n(config.key, kKeySize, key_.begin());
    } else {
      std::fill(key_.begin(), key_.end(), std::byte{0});
    }
  }

  /// Decrypt and process an HDLC frame received from the gateway.
  void ProcessReceivedFrame(const pw::hdlc::Frame& frame) {
    pw::ConstByteSpan data = frame.data();

    // Frame format: [Device ID (8)] [Nonce (16)] [Ciphertext (N)] [Tag (16)]
    if (data.size() < kFrameHeaderSize + kTagSize) {
      PW_LOG_WARN("Received frame too small: %zu", data.size());
      return;
    }

    // Extract nonce and ciphertext
    pw::ConstByteSpan nonce(data.data() + kDeviceIdSize, kNonceSize);
    size_t ciphertext_len = data.size() - kFrameHeaderSize - kTagSize;
    pw::ConstByteSpan ciphertext(data.data() + kFrameHeaderSize, ciphertext_len);
    pw::ConstByteSpan tag(data.data() + kFrameHeaderSize + ciphertext_len,
                          kTagSize);
    pw::ConstByteSpan associated_data(data.data(), kFrameHeaderSize);

    // Decrypt
    std::array<std::byte, kMaxPayloadSize> plaintext_buffer;
    if (ciphertext_len > plaintext_buffer.size()) {
      PW_LOG_WARN("Ciphertext too large: %zu", ciphertext_len);
      return;
    }
    pw::ByteSpan plaintext(plaintext_buffer.data(), ciphertext_len);

    pw::Status status = pb::crypto::AsconAead128Decrypt(
        key_, nonce, associated_data, ciphertext, tag, plaintext);
    if (!status.ok()) {
      PW_LOG_WARN("ASCON decryption failed");
      return;
    }

    // Feed to RPC client
    status = rpc_client.ProcessPacket(plaintext);
    if (!status.ok()) {
      PW_LOG_WARN("RPC ProcessPacket failed: %d",
                  static_cast<int>(status.code()));
    }
  }

  /// Read task that polls TCP and processes incoming RPC responses.
  class ReadTask : public pw::async2::Task {
   public:
    explicit ReadTask(Impl& impl) : impl_(impl) {}

   private:
    pw::async2::Poll<> DoPend(pw::async2::Context& cx) override {
      // Ensure connected before reading
      if (!impl_.tcp_stream.IsConnected()) {
        cx.ReEnqueue();
        return pw::async2::Pending();
      }

      // Try to read some bytes (non-blocking)
      std::array<std::byte, 64> read_buffer;
      pw::StatusWithSize result = impl_.tcp_stream.ReadNonBlocking(read_buffer);

      if (!result.ok()) {
        if (result.status() != pw::Status::ResourceExhausted()) {
          PW_LOG_WARN("TCP read error: %d",
                      static_cast<int>(result.status().code()));
        }
        cx.ReEnqueue();
        return pw::async2::Pending();
      }

      size_t bytes_read = result.size();
      if (bytes_read == 0) {
        cx.ReEnqueue();
        return pw::async2::Pending();
      }

      // Feed bytes to HDLC decoder
      impl_.hdlc_decoder_.Process(
          pw::ConstByteSpan(read_buffer.data(), bytes_read),
          [this](pw::Result<pw::hdlc::Frame> frame_result) {
            if (frame_result.ok()) {
              impl_.ProcessReceivedFrame(frame_result.value());
            }
          });

      cx.ReEnqueue();
      return pw::async2::Pending();
    }

    Impl& impl_;
  };

  HostTcpStream tcp_stream;
  AsconChannelOutput channel_output;
  std::array<pw::rpc::Channel, 1> channels;
  pw::rpc::Client rpc_client;
  uint64_t device_id_;
  std::array<std::byte, kKeySize> key_;
  pw::hdlc::DecoderBuffer<kMaxHdlcFrameSize> hdlc_decoder_;
  ReadTask read_task_{*this};
  pw::async2::Dispatcher* dispatcher_ = nullptr;
};

HostGatewayClient::HostGatewayClient(const GatewayConfig& config)
    : impl_(std::make_unique<Impl>(config)), config_(config) {}

HostGatewayClient::~HostGatewayClient() = default;

void HostGatewayClient::Start(pw::async2::Dispatcher& dispatcher) {
  impl_->dispatcher_ = &dispatcher;
  dispatcher.Post(impl_->read_task_);
}

pw::rpc::Client& HostGatewayClient::rpc_client() { return impl_->rpc_client; }

bool HostGatewayClient::IsConnected() const {
  return impl_->tcp_stream.IsConnected();
}

pw::Status HostGatewayClient::Connect() {
  return impl_->channel_output.EnsureConnected();
}

void HostGatewayClient::Disconnect() { impl_->tcp_stream.Disconnect(); }

}  // namespace maco::gateway
