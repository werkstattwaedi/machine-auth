// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// ParticleTcpSocket integration test firmware.
//
// Tests the ParticleTcpSocket implementation which uses a dedicated socket
// worker thread to avoid deadlocks with Particle's system thread.

#include "particle_tcp_socket_test.rpc.pb.h"

#include <cstring>

#include "concurrent_hal.h"
#include "pb_integration_tests/firmware/test_system.h"
#include "pb_socket/particle_tcp_socket.h"
#include "pw_log/log.h"
#include "pw_rpc/nanopb/server_reader_writer.h"
#include "pw_sync/binary_semaphore.h"

namespace {

namespace svc = maco::test::socket::pw_rpc::nanopb;

// Global socket instance (created on Configure, destroyed on Disconnect)
pb::socket::ParticleTcpSocket* g_socket = nullptr;

// Configuration for socket creation
struct {
  char host[64] = {0};
  uint16_t port = 0;
  uint32_t connect_timeout_ms = 10000;
  uint32_t read_timeout_ms = 0;
} g_config;

maco_test_socket_TcpState ToProtoState(pb::socket::TcpState state) {
  switch (state) {
    case pb::socket::TcpState::kDisconnected:
      return maco_test_socket_TcpState_TCP_STATE_DISCONNECTED;
    case pb::socket::TcpState::kConnecting:
      return maco_test_socket_TcpState_TCP_STATE_CONNECTING;
    case pb::socket::TcpState::kConnected:
      return maco_test_socket_TcpState_TCP_STATE_CONNECTED;
    case pb::socket::TcpState::kError:
      return maco_test_socket_TcpState_TCP_STATE_ERROR;
  }
  return maco_test_socket_TcpState_TCP_STATE_DISCONNECTED;
}

class TestControlServiceImpl
    : public svc::TestControl::Service<TestControlServiceImpl> {
 public:
  pw::Status WaitForCloud(const maco_test_socket_WaitForCloudRequest& request,
                          maco_test_socket_WaitForCloudResponse& response) {
    uint32_t timeout_ms = request.timeout_ms > 0 ? request.timeout_ms : 60000;
    PW_LOG_INFO("WaitForCloud: timeout=%u ms",
                static_cast<unsigned>(timeout_ms));
    response.connected = pb::test::WaitForCloudConnection(timeout_ms);
    return pw::OkStatus();
  }

  pw::Status Configure(const maco_test_socket_ConfigureRequest& request,
                       maco_test_socket_ConfigureResponse& response) {
    PW_LOG_INFO("Configure: host=%s, port=%u", request.host,
                static_cast<unsigned>(request.port));

    std::strncpy(g_config.host, request.host, sizeof(g_config.host) - 1);
    g_config.port = static_cast<uint16_t>(request.port);
    g_config.connect_timeout_ms = request.connect_timeout_ms;
    g_config.read_timeout_ms = request.read_timeout_ms;

    response.success = true;
    return pw::OkStatus();
  }

  pw::Status Connect(const maco_test_socket_ConnectRequest& /*request*/,
                     maco_test_socket_ConnectResponse& response) {
    PW_LOG_INFO("Connect: host=%s, port=%u", g_config.host, g_config.port);

    if (g_config.host[0] == '\0') {
      response.success = false;
      std::strncpy(response.error, "Not configured",
                   sizeof(response.error) - 1);
      response.state = maco_test_socket_TcpState_TCP_STATE_DISCONNECTED;
      return pw::OkStatus();
    }

    // Destroy existing socket if any
    if (g_socket != nullptr) {
      delete g_socket;
      g_socket = nullptr;
    }

    // Create new socket with current config
    pb::socket::TcpConfig config{
        .host = g_config.host,
        .port = g_config.port,
        .connect_timeout_ms = g_config.connect_timeout_ms,
        .read_timeout_ms = g_config.read_timeout_ms,
    };
    g_socket = new pb::socket::ParticleTcpSocket(config);

    // Connect
    pw::Status status = g_socket->Connect();
    if (!status.ok()) {
      response.success = false;
      std::snprintf(response.error, sizeof(response.error),
                    "Connect failed: %d", g_socket->last_error());
      response.state = ToProtoState(g_socket->state());
      return pw::OkStatus();
    }

    response.success = true;
    response.state = ToProtoState(g_socket->state());
    return pw::OkStatus();
  }

  pw::Status WriteData(const maco_test_socket_WriteDataRequest& request,
                       maco_test_socket_WriteDataResponse& response) {
    PW_LOG_INFO("WriteData: size=%zu", request.data.size);

    if (g_socket == nullptr || !g_socket->IsConnected()) {
      response.success = false;
      std::strncpy(response.error, "Not connected",
                   sizeof(response.error) - 1);
      response.bytes_written = 0;
      return pw::OkStatus();
    }

    pw::ConstByteSpan data(
        reinterpret_cast<const std::byte*>(request.data.bytes),
        request.data.size);
    pw::Status status = g_socket->Write(data);

    if (!status.ok()) {
      response.success = false;
      std::snprintf(response.error, sizeof(response.error), "Write failed: %d",
                    g_socket->last_error());
      response.bytes_written = 0;
    } else {
      response.success = true;
      response.bytes_written = request.data.size;
    }
    return pw::OkStatus();
  }

  pw::Status ReadData(const maco_test_socket_ReadDataRequest& request,
                      maco_test_socket_ReadDataResponse& response) {
    PW_LOG_INFO("ReadData: max=%u", static_cast<unsigned>(request.max_bytes));

    if (g_socket == nullptr || !g_socket->IsConnected()) {
      response.success = false;
      std::strncpy(response.error, "Not connected",
                   sizeof(response.error) - 1);
      response.data.size = 0;
      return pw::OkStatus();
    }

    size_t read_size = std::min(static_cast<size_t>(request.max_bytes),
                                sizeof(response.data.bytes));
    pw::ByteSpan buffer(reinterpret_cast<std::byte*>(response.data.bytes),
                        read_size);
    pw::StatusWithSize result = g_socket->Read(buffer);

    if (!result.ok()) {
      response.success = false;
      std::snprintf(response.error, sizeof(response.error), "Read failed: %d",
                    g_socket->last_error());
      response.data.size = 0;
    } else {
      response.success = true;
      response.data.size = result.size();
    }
    return pw::OkStatus();
  }

  pw::Status Disconnect(const maco_test_socket_DisconnectRequest& /*request*/,
                        maco_test_socket_DisconnectResponse& response) {
    PW_LOG_INFO("Disconnect");

    if (g_socket != nullptr) {
      g_socket->Disconnect();
      delete g_socket;
      g_socket = nullptr;
    }

    response.success = true;
    response.state = maco_test_socket_TcpState_TCP_STATE_DISCONNECTED;
    return pw::OkStatus();
  }

  pw::Status GetState(const maco_test_socket_GetStateRequest& /*request*/,
                      maco_test_socket_GetStateResponse& response) {
    if (g_socket == nullptr) {
      response.state = maco_test_socket_TcpState_TCP_STATE_DISCONNECTED;
      response.is_connected = false;
      response.last_error = 0;
    } else {
      response.state = ToProtoState(g_socket->state());
      response.is_connected = g_socket->IsConnected();
      response.last_error = g_socket->last_error();
    }
    return pw::OkStatus();
  }

  pw::Status ConcurrentWriteTest(
      const maco_test_socket_ConcurrentWriteTestRequest& request,
      maco_test_socket_ConcurrentWriteTestResponse& response) {
    PW_LOG_INFO("ConcurrentWriteTest: host=%s, port=%u, data1=%zu, data2=%zu",
                request.host, static_cast<unsigned>(request.port),
                request.data1.size, request.data2.size);

    response.success = false;
    response.socket1_correct = false;
    response.socket2_correct = false;
    response.received1.size = 0;
    response.received2.size = 0;

    // Create two sockets with the same config
    pb::socket::TcpConfig config{
        .host = request.host,
        .port = static_cast<uint16_t>(request.port),
        .connect_timeout_ms = 10000,
        .read_timeout_ms = 5000,
    };

    pb::socket::ParticleTcpSocket socket1(config);
    pb::socket::ParticleTcpSocket socket2(config);

    // Connect socket 1
    pw::Status status = socket1.Connect();
    if (!status.ok()) {
      std::snprintf(response.error, sizeof(response.error),
                    "Socket 1 connect failed: %d", socket1.last_error());
      return pw::OkStatus();
    }
    PW_LOG_INFO("Socket 1 connected");

    // Connect socket 2
    status = socket2.Connect();
    if (!status.ok()) {
      std::snprintf(response.error, sizeof(response.error),
                    "Socket 2 connect failed: %d", socket2.last_error());
      socket1.Disconnect();
      return pw::OkStatus();
    }
    PW_LOG_INFO("Socket 2 connected");

    // Write from both sockets concurrently using separate threads
    // This ensures both Write requests are queued to the socket worker
    // before either completes.
    struct WriteContext {
      pb::socket::ParticleTcpSocket* socket;
      const uint8_t* data;
      size_t size;
      pw::Status result;
      pw::sync::BinarySemaphore done;
    };

    WriteContext ctx1{&socket1, request.data1.bytes, request.data1.size,
                      pw::Status::Unknown(), {}};
    WriteContext ctx2{&socket2, request.data2.bytes, request.data2.size,
                      pw::Status::Unknown(), {}};

    auto write_thread_fn = [](void* arg) {
      auto* ctx = static_cast<WriteContext*>(arg);
      pw::ConstByteSpan data(reinterpret_cast<const std::byte*>(ctx->data),
                             ctx->size);
      ctx->result = ctx->socket->Write(data);
      ctx->done.release();
    };

    // Start both write operations in parallel threads
    os_thread_t thread1, thread2;
    os_thread_create(&thread1, "write1", OS_THREAD_PRIORITY_DEFAULT,
                     write_thread_fn, &ctx1, 2048);
    os_thread_create(&thread2, "write2", OS_THREAD_PRIORITY_DEFAULT,
                     write_thread_fn, &ctx2, 2048);

    // Wait for both writes to complete
    ctx1.done.acquire();
    ctx2.done.acquire();

    // Join threads
    os_thread_join(thread1);
    os_thread_join(thread2);

    if (!ctx1.result.ok()) {
      std::snprintf(response.error, sizeof(response.error),
                    "Socket 1 write failed: %d", socket1.last_error());
      socket1.Disconnect();
      socket2.Disconnect();
      return pw::OkStatus();
    }
    if (!ctx2.result.ok()) {
      std::snprintf(response.error, sizeof(response.error),
                    "Socket 2 write failed: %d", socket2.last_error());
      socket1.Disconnect();
      socket2.Disconnect();
      return pw::OkStatus();
    }
    PW_LOG_INFO("Both writes completed, starting reads");

    // Read from both sockets with retry (non-blocking recv may return EAGAIN)
    // Retry for up to 5 seconds total
    constexpr int kMaxRetries = 50;

    pw::ByteSpan buf1(reinterpret_cast<std::byte*>(response.received1.bytes),
                      sizeof(response.received1.bytes));
    pw::StatusWithSize read1;
    PW_LOG_INFO("Starting socket1 read loop");
    for (int i = 0; i < kMaxRetries; ++i) {
      PW_LOG_DEBUG("Socket1 read attempt %d", i);
      read1 = socket1.Read(buf1);
      PW_LOG_DEBUG("Socket1 read returned: ok=%d size=%zu err=%d",
                   read1.ok(), read1.size(), socket1.last_error());
      if (read1.ok() && read1.size() > 0) {
        PW_LOG_INFO("Socket1 read success: %zu bytes", read1.size());
        break;
      }
      if (!read1.ok() && read1.status() != pw::Status::FailedPrecondition()) {
        PW_LOG_WARN("Socket1 read error: %d", static_cast<int>(read1.status().code()));
        break;
      }
      os_thread_yield();
      // Small delay before retry
      for (volatile int j = 0; j < 50000; ++j) {}
    }
    if (!read1.ok() || read1.size() == 0) {
      std::snprintf(response.error, sizeof(response.error),
                    "Socket 1 read failed: %d (size=%zu)", socket1.last_error(),
                    read1.size());
      PW_LOG_ERROR("Socket1 read FAILED: %s", response.error);
      socket1.Disconnect();
      socket2.Disconnect();
      return pw::OkStatus();
    }
    response.received1.size = read1.size();

    pw::ByteSpan buf2(reinterpret_cast<std::byte*>(response.received2.bytes),
                      sizeof(response.received2.bytes));
    pw::StatusWithSize read2;
    PW_LOG_INFO("Starting socket2 read loop");
    for (int i = 0; i < kMaxRetries; ++i) {
      PW_LOG_DEBUG("Socket2 read attempt %d", i);
      read2 = socket2.Read(buf2);
      PW_LOG_DEBUG("Socket2 read returned: ok=%d size=%zu err=%d",
                   read2.ok(), read2.size(), socket2.last_error());
      if (read2.ok() && read2.size() > 0) {
        PW_LOG_INFO("Socket2 read success: %zu bytes", read2.size());
        break;
      }
      if (!read2.ok() && read2.status() != pw::Status::FailedPrecondition()) {
        PW_LOG_WARN("Socket2 read error: %d", static_cast<int>(read2.status().code()));
        break;
      }
      os_thread_yield();
      for (volatile int j = 0; j < 50000; ++j) {}
    }
    if (!read2.ok() || read2.size() == 0) {
      std::snprintf(response.error, sizeof(response.error),
                    "Socket 2 read failed: %d (size=%zu)", socket2.last_error(),
                    read2.size());
      PW_LOG_ERROR("Socket2 read FAILED: %s", response.error);
      socket1.Disconnect();
      socket2.Disconnect();
      return pw::OkStatus();
    }
    response.received2.size = read2.size();

    PW_LOG_INFO("Read %zu bytes from socket 1, %zu bytes from socket 2",
                read1.size(), read2.size());

    // Verify correctness
    response.socket1_correct =
        (read1.size() == request.data1.size) &&
        (std::memcmp(response.received1.bytes, request.data1.bytes,
                     request.data1.size) == 0);
    response.socket2_correct =
        (read2.size() == request.data2.size) &&
        (std::memcmp(response.received2.bytes, request.data2.bytes,
                     request.data2.size) == 0);

    response.success = response.socket1_correct && response.socket2_correct;

    if (!response.success) {
      std::snprintf(response.error, sizeof(response.error),
                    "Data mismatch: s1=%s s2=%s",
                    response.socket1_correct ? "ok" : "WRONG",
                    response.socket2_correct ? "ok" : "WRONG");
    }

    // Clean up
    socket1.Disconnect();
    socket2.Disconnect();

    return pw::OkStatus();
  }
};

void TestInit() {
  static TestControlServiceImpl service;
  pb::test::GetRpcServer().RegisterService(service);
  PW_LOG_INFO("ParticleTcpSocket integration test firmware initialized");
}

}  // namespace

int main() { pb::test::TestSystemInit(TestInit); }
