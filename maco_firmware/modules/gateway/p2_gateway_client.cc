// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/gateway/p2_gateway_client.h"

#include <array>
#include <cstring>

#include "pb_crypto/pb_crypto.h"
#include "pb_socket/particle_tcp_socket.h"
#include "pb_socket/tcp_socket_stream_adapter.h"
#include "pw_async2/context.h"
#include "pw_async2/poll.h"
#include "pw_async2/task.h"
#include "pw_bytes/endian.h"
#include "pw_hdlc/decoder.h"
#include "pw_hdlc/encoder.h"
#include "pw_rpc/channel.h"
#include "rng_hal.h"

#define PW_LOG_MODULE_NAME "gateway"
#include "pw_log/log.h"

namespace maco::gateway {

namespace {

// HDLC address for gateway communication
constexpr uint64_t kHdlcAddress = 1;

/// Generate a random uint64_t using hardware RNG.
/// This prevents nonce reuse across device reboots.
uint64_t GetRandomNonceStart() {
  uint32_t high = HAL_RNG_GetRandomNumber();
  uint32_t low = HAL_RNG_GetRandomNumber();
  return (static_cast<uint64_t>(high) << 32) | static_cast<uint64_t>(low);
}

// Maximum unencrypted payload size
constexpr size_t kMaxPayloadSize = 512;

// Size constants for ASCON
constexpr size_t kDeviceIdSize = 8;
constexpr size_t kNonceSize = 16;
constexpr size_t kTagSize = 16;
constexpr size_t kKeySize = 16;
constexpr size_t kFrameHeaderSize = kDeviceIdSize + kNonceSize;

// Maximum HDLC frame size (encrypted payload + header + tag)
constexpr size_t kMaxHdlcFrameSize =
    kDeviceIdSize + kNonceSize + kMaxPayloadSize + kTagSize;

}  // namespace

/// ASCON-encrypted channel output with automatic reconnection.
class AsconChannelOutput : public pw::rpc::ChannelOutput {
 public:
  AsconChannelOutput(pb::socket::TcpSocket& tcp_socket,
                     pb::socket::TcpSocketStreamAdapter& stream_adapter,
                     pw::ConstByteSpan key,
                     uint64_t device_id,
                     const char* channel_name)
      : ChannelOutput(channel_name),
        tcp_socket_(tcp_socket),
        stream_adapter_(stream_adapter),
        device_id_(device_id) {
    PW_LOG_INFO("AsconChannelOutput: constructing...");
    if (key.size() >= kKeySize) {
      std::copy_n(key.begin(), kKeySize, key_.begin());
    } else {
      std::fill(key_.begin(), key_.end(), std::byte{0});
      std::copy(key.begin(), key.end(), key_.begin());
    }
    PW_LOG_INFO("AsconChannelOutput: done, nonce_counter initialized");
  }

  pw::Status Send(pw::span<const std::byte> buffer) override {
    if (buffer.size() > kMaxPayloadSize) {
      PW_LOG_ERROR("Payload too large: %zu > %zu", buffer.size(),
                   kMaxPayloadSize);
      return pw::Status::ResourceExhausted();
    }

    // Ensure connected
    pw::Status status = EnsureConnected();
    if (!status.ok()) {
      return status;
    }

    // Build frame: [Device ID (8)] [Nonce (16)] [Encrypted (N)] [Tag (16)]
    const size_t frame_size =
        kDeviceIdSize + kNonceSize + buffer.size() + kTagSize;

    std::array<std::byte,
               kDeviceIdSize + kNonceSize + kMaxPayloadSize + kTagSize>
        frame_buffer;

    if (frame_size > frame_buffer.size()) {
      return pw::Status::ResourceExhausted();
    }

    // Write device ID (big-endian)
    auto device_id_bytes = pw::bytes::CopyInOrder(pw::endian::big, device_id_);
    std::copy(device_id_bytes.begin(), device_id_bytes.end(), frame_buffer.begin());

    // Build and write nonce
    auto nonce = BuildNonce();
    std::copy(nonce.begin(), nonce.end(), frame_buffer.begin() + kDeviceIdSize);

    // Encrypt payload
    pw::ByteSpan ciphertext(frame_buffer.data() + kFrameHeaderSize,
                            buffer.size());
    pw::ByteSpan tag(frame_buffer.data() + kFrameHeaderSize + buffer.size(),
                     kTagSize);

    pw::ConstByteSpan associated_data(frame_buffer.data(), kFrameHeaderSize);

    status = pb::crypto::AsconAead128Encrypt(key_, nonce, associated_data,
                                             buffer, ciphertext, tag);
    if (!status.ok()) {
      PW_LOG_ERROR("ASCON encryption failed");
      return status;
    }

    ++nonce_counter_;

    // Send with reconnect on failure
    pw::ConstByteSpan frame(frame_buffer.data(), frame_size);
    return SendFrame(frame);
  }

  size_t MaximumTransmissionUnit() override { return kMaxPayloadSize; }

  pw::Status EnsureConnected() {
    if (tcp_socket_.IsConnected()) {
      return pw::OkStatus();
    }

    PW_LOG_INFO("Connecting to gateway...");
    pw::Status status = tcp_socket_.Connect();
    if (!status.ok()) {
      PW_LOG_ERROR("Failed to connect: %d", static_cast<int>(status.code()));
      return status;
    }

    PW_LOG_INFO("Connected to gateway");
    return pw::OkStatus();
  }

 private:
  pw::Status SendFrame(pw::ConstByteSpan frame) {
    // Use stream adapter for pw_hdlc compatibility
    pw::Status status =
        pw::hdlc::WriteUIFrame(kHdlcAddress, frame, stream_adapter_);
    if (status.ok()) {
      return pw::OkStatus();
    }

    PW_LOG_WARN("HDLC write failed, attempting reconnect...");
    tcp_socket_.Disconnect();

    status = EnsureConnected();
    if (!status.ok()) {
      return status;
    }

    status = pw::hdlc::WriteUIFrame(kHdlcAddress, frame, stream_adapter_);
    if (!status.ok()) {
      PW_LOG_ERROR("HDLC write failed after reconnect");
      tcp_socket_.Disconnect();
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

  pb::socket::TcpSocket& tcp_socket_;
  pb::socket::TcpSocketStreamAdapter& stream_adapter_;
  std::array<std::byte, kKeySize> key_;
  uint64_t device_id_;
  uint64_t nonce_counter_ = GetRandomNonceStart();
};

/// Implementation details for P2GatewayClient
struct P2GatewayClient::Impl {
  Impl(const GatewayConfig& config, P2GatewayClient& parent)
      : parent_(parent),
        tcp_config{.host = config.host,
                   .port = config.port,
                   .connect_timeout_ms = config.connect_timeout_ms,
                   .read_timeout_ms = config.read_timeout_ms},
        tcp_socket(tcp_config),
        stream_adapter(tcp_socket),
        channel_output(tcp_socket,
                       stream_adapter,
                       pw::ConstByteSpan(config.key, kKeySize),
                       config.device_id,
                       "gateway"),
        channels{pw::rpc::Channel::Create<1>(&channel_output)},
        rpc_client(channels),
        device_id_(config.device_id) {
    PW_LOG_INFO("Impl: initializer list done");
    // Copy key for decryption
    if (config.key != nullptr) {
      std::copy_n(config.key, kKeySize, key_.begin());
    } else {
      std::fill(key_.begin(), key_.end(), std::byte{0});
    }
    PW_LOG_INFO("Impl: key copied, construction complete");
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
      if (!impl_.tcp_socket.IsConnected()) {
        cx.ReEnqueue();
        return pw::async2::Pending();
      }

      // Try to read some bytes (non-blocking via short timeout on socket)
      std::array<std::byte, 64> read_buffer;
      auto result = impl_.tcp_socket.Read(read_buffer);

      if (!result.ok()) {
        PW_LOG_WARN("TCP read error: %d",
                    static_cast<int>(result.status().code()));
        cx.ReEnqueue();
        return pw::async2::Pending();
      }

      if (result.size() == 0) {
        // No data available, keep polling
        cx.ReEnqueue();
        return pw::async2::Pending();
      }

      pw::ConstByteSpan data(read_buffer.data(), result.size());

      // Feed bytes to HDLC decoder
      impl_.hdlc_decoder_.Process(
          data,
          [this](pw::Result<pw::hdlc::Frame> frame_result) {
            if (frame_result.ok()) {
              impl_.ProcessReceivedFrame(frame_result.value());
            }
          });

      // Keep running
      cx.ReEnqueue();
      return pw::async2::Pending();
    }

    Impl& impl_;
  };

  P2GatewayClient& parent_;
  pb::socket::TcpConfig tcp_config;
  pb::socket::ParticleTcpSocket tcp_socket;
  pb::socket::TcpSocketStreamAdapter stream_adapter;
  AsconChannelOutput channel_output;
  std::array<pw::rpc::Channel, 1> channels;
  pw::rpc::Client rpc_client;
  uint64_t device_id_;
  std::array<std::byte, kKeySize> key_;
  pw::hdlc::DecoderBuffer<kMaxHdlcFrameSize> hdlc_decoder_;
  ReadTask read_task_{*this};
  pw::async2::Dispatcher* dispatcher_ = nullptr;
};

P2GatewayClient::P2GatewayClient(const GatewayConfig& config)
    : impl_(std::make_unique<Impl>(config, *this)), config_(config) {
  PW_LOG_INFO("P2GatewayClient constructed");
}

P2GatewayClient::~P2GatewayClient() = default;

void P2GatewayClient::Start(pw::async2::Dispatcher& dispatcher) {
  impl_->dispatcher_ = &dispatcher;
  dispatcher.Post(impl_->read_task_);
}

pw::rpc::Client& P2GatewayClient::rpc_client() { return impl_->rpc_client; }

bool P2GatewayClient::IsConnected() const {
  return impl_->tcp_socket.IsConnected();
}

pw::Status P2GatewayClient::Connect() {
  return impl_->channel_output.EnsureConnected();
}

void P2GatewayClient::Disconnect() { impl_->tcp_socket.Disconnect(); }

}  // namespace maco::gateway
