// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Firebase client integration test firmware.
//
// This is the test-specific firmware that runs on the P2 device during
// integration testing. It provides an RPC service (TestControl) that
// allows the Python test to:
// 1. Configure the gateway connection (host/port)
// 2. Trigger Firebase operations and observe results

#include "firebase_client_test.rpc.pwpb.h"
#include "pb_integration_tests/firmware/test_system.h"

#include <array>
#include <cstring>
#include <memory>
#include <optional>
#include <variant>

#include "firebase/firebase_client.h"
#include "maco_firmware/modules/gateway/p2_gateway_client.h"
#include "pb_crypto/pb_crypto.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_bytes/array.h"
#include "pw_log/log.h"
#include "pw_rpc/pwpb/server_reader_writer.h"
#include "pw_system/system.h"

namespace {

namespace msgs = maco::test::firebase::pwpb;
namespace svc = maco::test::firebase::pw_rpc::pwpb;

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
    pw::rpc::PwpbUnaryResponder<msgs::TriggerStartSessionResponse::Message>;

// TestControl service implementation
class TestControlServiceImpl
    : public svc::TestControl::Service<TestControlServiceImpl> {
 public:
  TestControlServiceImpl() : coro_cx_(pw::System().allocator()) {}

  // RPC: ConfigureGateway
  pw::Status ConfigureGateway(
      const msgs::ConfigureGatewayRequest::Message& request,
      msgs::ConfigureGatewayResponse::Message& response) {
    PW_LOG_INFO("ConfigureGateway: host=%s, port=%u", request.host.c_str(),
                static_cast<unsigned>(request.port));

    // Store gateway configuration for later use
    gateway_host_ = std::string(request.host.data(), request.host.size());
    gateway_port_ = request.port;

    // Derive the key (same as gateway uses)
    key_ = DeriveKey();

    // Create gateway config
    maco::gateway::GatewayConfig config{
        .host = gateway_host_.c_str(),
        .port = static_cast<uint16_t>(gateway_port_),
        .connect_timeout_ms = 10000,
        .read_timeout_ms = 5000,
        .device_id = kTestDeviceId,
        .key = key_.data(),
        .channel_id = 1,
    };

    // Create gateway and firebase clients (lazy init, kept alive as members)
    gateway_.emplace(config);
    firebase_.emplace(gateway_->rpc_client(), gateway_->channel_id());

    // Start the gateway read task on the system dispatcher
    gateway_->Start(pw::System().dispatcher());

    // Connect to gateway
    auto connect_status = gateway_->Connect();
    if (!connect_status.ok()) {
      PW_LOG_ERROR("Failed to connect to gateway: %d",
                   static_cast<int>(connect_status.code()));
      response.success = false;
      gateway_.reset();
      firebase_.reset();
      return pw::OkStatus();
    }

    PW_LOG_INFO("Connected to gateway at %s:%u", gateway_host_.c_str(),
                gateway_port_);

    response.success = true;
    return pw::OkStatus();
  }

  // RPC: TriggerStartSession (async handler)
  void TriggerStartSession(
      const msgs::TriggerStartSessionRequest::Message& request,
      StartSessionResponder& responder) {
    PW_LOG_INFO("TriggerStartSession: tag_uid size=%u",
                static_cast<unsigned>(request.tag_uid.size()));

    if (!gateway_.has_value() || !firebase_.has_value()) {
      msgs::TriggerStartSessionResponse::Message response;
      response.success = false;
      response.error.assign("Gateway not configured");
      responder.Finish(response, pw::OkStatus()).IgnoreError();
      return;
    }

    // Prepare the tag UID
    maco::firebase::TagUid tag_uid;
    size_t uid_size = std::min(request.tag_uid.size(), tag_uid.value.size());
    std::copy(request.tag_uid.begin(), request.tag_uid.begin() + uid_size,
              tag_uid.value.begin());

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
      maco::firebase::TagUid tag_uid,
      StartSessionResponder responder) {
    PW_LOG_INFO("Starting TerminalCheckin coroutine");

    auto result = co_await firebase_->TerminalCheckin(cx, tag_uid);

    PW_LOG_INFO("TerminalCheckin coroutine complete");

    msgs::TriggerStartSessionResponse::Message response;

    if (!result.ok()) {
      PW_LOG_ERROR("TerminalCheckin failed: %d",
                   static_cast<int>(result.status().code()));
      response.success = false;
      response.error.assign("TerminalCheckin RPC failed");
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
              response.session_id.assign(
                  variant.authentication_id.value.data(),
                  variant.authentication_id.value.size());
              PW_LOG_INFO("Authorized with existing auth: %s",
                          response.session_id.c_str());
            } else {
              response.auth_required = true;
              PW_LOG_INFO("Authorized but auth required");
            }
          } else if constexpr (std::is_same_v<T,
                                              maco::firebase::CheckinRejected>) {
            response.success = false;
            response.error.assign(variant.message.data(),
                                  variant.message.size());
            PW_LOG_INFO("Rejected: %s", response.error.c_str());
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
  static TestControlServiceImpl service;
  g_service = &service;

  // Register the test control service
  pb::test::GetRpcServer().RegisterService(service);

  PW_LOG_INFO("Firebase client integration test firmware initialized");
}

}  // namespace

int main() {
  pb::test::TestSystemInit(TestInit);
}
