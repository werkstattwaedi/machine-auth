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
#include "pw_log/log.h"

namespace {

namespace msgs = maco::test::firebase::pwpb;
namespace svc = maco::test::firebase::pw_rpc::pwpb;

// TestControl service implementation
class TestControlServiceImpl : public svc::TestControl::Service<TestControlServiceImpl> {
 public:
  // RPC: ConfigureGateway
  pw::Status ConfigureGateway(const msgs::ConfigureGatewayRequest::Message& request,
                              msgs::ConfigureGatewayResponse::Message& response) {
    PW_LOG_INFO("ConfigureGateway: host=%s, port=%u",
                request.host.c_str(),
                static_cast<unsigned>(request.port));

    // Store gateway configuration for later use
    gateway_host_ = std::string(request.host.data(), request.host.size());
    gateway_port_ = request.port;
    gateway_configured_ = true;

    response.success = true;
    return pw::OkStatus();
  }

  // RPC: TriggerStartSession
  pw::Status TriggerStartSession(
      const msgs::TriggerStartSessionRequest::Message& request,
      msgs::TriggerStartSessionResponse::Message& response) {
    PW_LOG_INFO("TriggerStartSession: tag_uid size=%u",
                static_cast<unsigned>(request.tag_uid.size()));

    if (!gateway_configured_) {
      response.success = false;
      response.error.assign("Gateway not configured");
      return pw::OkStatus();
    }

    // TODO: Actually call FirebaseClient.StartSession() here
    // For now, return a placeholder response

    response.success = false;
    response.auth_required = false;
    response.error.assign("Not yet implemented");

    return pw::OkStatus();
  }

 private:
  bool gateway_configured_ = false;
  std::string gateway_host_;
  uint32_t gateway_port_ = 0;
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
