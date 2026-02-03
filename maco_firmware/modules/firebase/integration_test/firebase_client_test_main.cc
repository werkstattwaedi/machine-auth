// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Firebase client integration test firmware.
//
// This is the test-specific firmware that runs on the P2 device during
// integration testing. It provides an RPC service (TestControl) that
// allows the Python test to:
// 1. Configure the gateway connection (host/port)
// 2. Trigger Firebase operations and observe results

#include "firebase_client_test.rpc.pb.h"
#include "pb_integration_tests/firmware/test_system.h"

#include <array>
#include <cstring>
#include <memory>
#include <optional>
#include <variant>

#include "firebase/firebase_client.h"
#include "maco_firmware/modules/gateway/p2_gateway_client.h"
#include "maco_firmware/types.h"
#include "pb_crypto/pb_crypto.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_bytes/array.h"
#include "pw_log/log.h"
#include "pw_rpc/nanopb/server_reader_writer.h"
#include "pw_system/system.h"

namespace {

namespace svc = maco::test::firebase::pw_rpc::nanopb;

// Test constants - must match gateway_process.py DEFAULT_TEST_MASTER_KEY
constexpr std::array<std::byte, 16> kTestMasterSecret = {
    std::byte{0x00}, std::byte{0x01}, std::byte{0x02}, std::byte{0x03},
    std::byte{0x04}, std::byte{0x05}, std::byte{0x06}, std::byte{0x07},
    std::byte{0x08}, std::byte{0x09}, std::byte{0x0A}, std::byte{0x0B},
    std::byte{0x0C}, std::byte{0x0D}, std::byte{0x0E}, std::byte{0x0F},
};

// Device ID for testing
constexpr uint64_t kTestDeviceId = 0x0001020304050607ULL;

/// Derive the ASCON key from master secret and device ID.
/// key = ASCON-Hash256(master_secret || device_id)[0:16]
std::array<std::byte, 16> DeriveKey() {
  std::array<std::byte, 24> key_material;  // 16 + 8 bytes
  std::copy(kTestMasterSecret.begin(), kTestMasterSecret.end(),
            key_material.begin());

  // Append device ID in big-endian
  for (int i = 7; i >= 0; --i) {
    key_material[16 + (7 - i)] =
        static_cast<std::byte>((kTestDeviceId >> (i * 8)) & 0xFF);
  }

  std::array<std::byte, pb::crypto::kAsconHashSize> hash;
  auto status = pb::crypto::AsconHash256(key_material, hash);
  if (!status.ok()) {
    PW_LOG_ERROR("Key derivation failed: %d", static_cast<int>(status.code()));
    return {};
  }

  // Use first 16 bytes of hash as ASCON key
  std::array<std::byte, pb::crypto::kAsconKeySize> key;
  std::copy(hash.begin(), hash.begin() + key.size(), key.begin());
  return key;
}

// Type alias for the TriggerStartSession responder
using StartSessionResponder =
    pw::rpc::NanopbUnaryResponder<maco_test_firebase_TriggerStartSessionResponse>;

// TestControl service implementation
class TestControlServiceImpl
    : public svc::TestControl::Service<TestControlServiceImpl> {
 public:
  TestControlServiceImpl() : coro_cx_(pw::System().allocator()) {
    PW_LOG_INFO("TestControlServiceImpl constructed");
  }

  // RPC: Ping - simple connectivity test
  pw::Status Ping(const maco_test_firebase_PingRequest& request,
                  maco_test_firebase_PingResponse& response) {
    (void)request;
    PW_LOG_INFO(">>> Ping received <<<");
    response.ok = true;
    return pw::OkStatus();
  }

  // Helper to create gateway - in separate function to reduce stack pressure
  __attribute__((noinline)) bool CreateGatewayClient() {
    PW_LOG_INFO("CreateGatewayClient: Creating config...");
    maco::gateway::GatewayConfig config{
        .host = gateway_host_.c_str(),
        .port = static_cast<uint16_t>(gateway_port_),
        .connect_timeout_ms = 10000,
        .read_timeout_ms = 5000,
        .device_id = kTestDeviceId,
        .key = key_.data(),
        .channel_id = 1,
    };

    PW_LOG_INFO("CreateGatewayClient: Creating P2GatewayClient...");
    gateway_.emplace(config);
    PW_LOG_INFO("CreateGatewayClient: Done");
    return true;
  }

  // Helper to connect gateway - in separate function to reduce stack pressure
  __attribute__((noinline)) bool ConnectGateway() {
    PW_LOG_INFO("ConnectGateway: Creating FirebaseClient...");
    firebase_.emplace(gateway_->rpc_client(), gateway_->channel_id());

    PW_LOG_INFO("ConnectGateway: Starting gateway...");
    gateway_->Start(pw::System().dispatcher());

    PW_LOG_INFO("ConnectGateway: Connecting...");
    auto connect_status = gateway_->Connect();
    if (!connect_status.ok()) {
      PW_LOG_ERROR("Failed to connect to gateway: %d",
                   static_cast<int>(connect_status.code()));
      gateway_.reset();
      firebase_.reset();
      return false;
    }
    PW_LOG_INFO("ConnectGateway: Done");
    return true;
  }

  // RPC: ConfigureGateway
  pw::Status ConfigureGateway(
      const maco_test_firebase_ConfigureGatewayRequest& request,
      maco_test_firebase_ConfigureGatewayResponse& response) {
    PW_LOG_INFO(">>> ConfigureGateway ENTRY <<<");
    PW_LOG_INFO("ConfigureGateway: host=%s, port=%u", request.host,
                static_cast<unsigned>(request.port));

    // Store gateway configuration for later use
    gateway_host_ = std::string(request.host);
    gateway_port_ = request.port;

    // Derive the key (same as gateway uses)
    key_ = DeriveKey();

    // Create gateway client (in separate function to reduce stack)
    if (!CreateGatewayClient()) {
      response.success = false;
      return pw::OkStatus();
    }

    // Connect (in separate function to reduce stack)
    if (!ConnectGateway()) {
      response.success = false;
      return pw::OkStatus();
    }

    PW_LOG_INFO("Connected to gateway at %s:%u", gateway_host_.c_str(),
                gateway_port_);

    response.success = true;
    return pw::OkStatus();

#if 0  // Keep disabled code for reference
    PW_LOG_INFO("ConfigureGateway: host=%s, port=%u", request.host,
                static_cast<unsigned>(request.port));

    // Store gateway configuration for later use
    PW_LOG_INFO("Step 1: Storing host string...");
    gateway_host_ = std::string(request.host);
    gateway_port_ = request.port;
    PW_LOG_INFO("Step 1: Done, host=%s", gateway_host_.c_str());

    // Derive the key (same as gateway uses)
    PW_LOG_INFO("Step 2: Deriving key...");
    key_ = DeriveKey();
    PW_LOG_INFO("Step 2: Done");

    // Create gateway config
    PW_LOG_INFO("Step 3: Creating config...");
    maco::gateway::GatewayConfig config{
        .host = gateway_host_.c_str(),
        .port = static_cast<uint16_t>(gateway_port_),
        .connect_timeout_ms = 10000,
        .read_timeout_ms = 5000,
        .device_id = kTestDeviceId,
        .key = key_.data(),
        .channel_id = 1,
    };
    PW_LOG_INFO("Step 3: Done");

    // Create gateway and firebase clients (lazy init, kept alive as members)
    PW_LOG_INFO("Step 4: Creating P2GatewayClient...");
    gateway_.emplace(config);
    PW_LOG_INFO("Step 4: Done");

    PW_LOG_INFO("Step 5: Creating FirebaseClient...");
    firebase_.emplace(gateway_->rpc_client(), gateway_->channel_id());
    PW_LOG_INFO("Step 5: Done");

    // Start the gateway read task on the system dispatcher
    PW_LOG_INFO("Step 6: Starting gateway...");
    gateway_->Start(pw::System().dispatcher());
    PW_LOG_INFO("Step 6: Done");

    // Connect to gateway
    PW_LOG_INFO("Step 7: Connecting to gateway...");
    auto connect_status = gateway_->Connect();
    if (!connect_status.ok()) {
      PW_LOG_ERROR("Failed to connect to gateway: %d",
                   static_cast<int>(connect_status.code()));
      response.success = false;
      gateway_.reset();
      firebase_.reset();
      return pw::OkStatus();
    }
    PW_LOG_INFO("Step 7: Done");

    PW_LOG_INFO("Connected to gateway at %s:%u", gateway_host_.c_str(),
                gateway_port_);

    response.success = true;
    return pw::OkStatus();
#endif
  }

  // RPC: TriggerStartSession (async handler)
  void TriggerStartSession(
      const maco_test_firebase_TriggerStartSessionRequest& request,
      StartSessionResponder& responder) {
    PW_LOG_INFO("TriggerStartSession: tag_uid size=%u",
                static_cast<unsigned>(request.tag_uid.size));

    if (!gateway_.has_value() || !firebase_.has_value()) {
      maco_test_firebase_TriggerStartSessionResponse response =
          maco_test_firebase_TriggerStartSessionResponse_init_zero;
      response.success = false;
      std::strncpy(response.error, "Gateway not configured",
                   sizeof(response.error) - 1);
      responder.Finish(response, pw::OkStatus()).IgnoreError();
      return;
    }

    // Prepare the tag UID from bytes
    auto tag_uid_result = maco::TagUid::FromBytes(pw::ConstByteSpan(
        reinterpret_cast<const std::byte*>(request.tag_uid.bytes),
        request.tag_uid.size));
    if (!tag_uid_result.ok()) {
      maco_test_firebase_TriggerStartSessionResponse response =
          maco_test_firebase_TriggerStartSessionResponse_init_zero;
      response.success = false;
      std::strncpy(response.error, "Invalid tag UID", sizeof(response.error) - 1);
      responder.Finish(response, pw::OkStatus()).IgnoreError();
      return;
    }
    auto tag_uid = *tag_uid_result;

    // Create and post the async handler coroutine
    auto coro = HandleSessionAsync(coro_cx_, tag_uid, std::move(responder));
    task_.emplace(std::move(coro), [](pw::Status s) {
      PW_LOG_ERROR("Session coroutine failed: %d", static_cast<int>(s.code()));
    });
    pw::System().dispatcher().Post(*task_);
  }

 private:
  // Coroutine that handles the async Firebase call and finishes the RPC
  pw::async2::Coro<pw::Status> HandleSessionAsync(
      pw::async2::CoroContext& cx,
      maco::TagUid tag_uid,
      StartSessionResponder responder) {
    PW_LOG_INFO("Starting TerminalCheckin coroutine");

    auto result = co_await firebase_->TerminalCheckin(cx, tag_uid);

    PW_LOG_INFO("TerminalCheckin coroutine complete");

    maco_test_firebase_TriggerStartSessionResponse response =
        maco_test_firebase_TriggerStartSessionResponse_init_zero;

    if (!result.ok()) {
      PW_LOG_ERROR("TerminalCheckin failed: %d",
                   static_cast<int>(result.status().code()));
      response.success = false;
      std::strncpy(response.error, "TerminalCheckin RPC failed",
                   sizeof(response.error) - 1);
      responder.Finish(response, pw::OkStatus()).IgnoreError();
      co_return pw::OkStatus();
    }

    // Map the Firebase response to our test response using std::visit
    const auto& checkin_result = result.value();

    std::visit(
        [&response](const auto& variant) {
          using T = std::decay_t<decltype(variant)>;
          if constexpr (std::is_same_v<T, maco::firebase::CheckinAuthorized>) {
            response.success = true;
            if (variant.has_existing_auth()) {
              response.auth_required = false;
              auto auth_id_str = variant.authentication_id.value();
              std::strncpy(response.session_id, auth_id_str.data(),
                           std::min(auth_id_str.size(),
                                    sizeof(response.session_id) - 1));
              PW_LOG_INFO("Authorized with existing auth: %s",
                          response.session_id);
            } else {
              response.auth_required = true;
              PW_LOG_INFO("Authorized but auth required");
            }
          } else if constexpr (std::is_same_v<T,
                                              maco::firebase::CheckinRejected>) {
            response.success = false;
            auto msg = std::string_view(variant.message);
            std::strncpy(response.error, msg.data(),
                         std::min(msg.size(), sizeof(response.error) - 1));
            PW_LOG_INFO("Rejected: %s", response.error);
          }
        },
        checkin_result);

    responder.Finish(response, pw::OkStatus()).IgnoreError();
    co_return pw::OkStatus();
  }

  std::string gateway_host_;
  uint32_t gateway_port_ = 0;
  std::array<std::byte, 16> key_{};

  // Gateway and Firebase clients - kept alive as long as service exists
  std::optional<maco::gateway::P2GatewayClient> gateway_;
  std::optional<maco::firebase::FirebaseClient> firebase_;

  // Coroutine context and task - must outlive the async operation
  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

// Global service instance (must outlive the RPC server)
TestControlServiceImpl* g_service = nullptr;

void TestInit() {
  PW_LOG_INFO("TestInit: starting...");
  static TestControlServiceImpl service;
  PW_LOG_INFO("TestInit: service created");
  g_service = &service;

  // Register the test control service
  pb::test::GetRpcServer().RegisterService(service);

  PW_LOG_INFO("Firebase client integration test firmware initialized");
}

}  // namespace

int main() {
  pb::test::TestSystemInit(TestInit);
}
