// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Minimal test system for P2 integration tests.
//
// This provides a stripped-down pw_system setup for integration tests:
// - USB serial RPC transport (HDLC)
// - Access to the RPC server for registering test-specific services
// - Basic logging via pw_log
//
// Usage:
//   void TestInit() {
//     static MyTestService service;
//     pb::test::GetRpcServer().RegisterService(service);
//   }
//
//   int main() {
//     pb::test::TestSystemInit(TestInit);
//   }

#pragma once

#include "pw_function/function.h"
#include "pw_rpc/server.h"

namespace pb::test {

/// Returns the RPC server for registering test-specific services.
/// Must be called during or after the init callback in TestSystemInit.
pw::rpc::Server& GetRpcServer();

/// Initializes the test system and starts the main loop.
///
/// This function:
/// 1. Sets up USB serial I/O
/// 2. Initializes pw_system (allocator, dispatcher, RPC server)
/// 3. Calls the init_callback for test-specific initialization
/// 4. Starts the system and never returns
///
/// @param init_callback Function to call for test-specific initialization.
///                      Use this to register RPC services, set up test state, etc.
[[noreturn]] void TestSystemInit(pw::Function<void()> init_callback);

/// Blocks until the device is connected to the Particle cloud.
///
/// This polls spark_cloud_flag_connected() every 100ms until it returns true,
/// or until the timeout is reached.
///
/// @param timeout_ms Maximum time to wait in milliseconds. 0 = wait forever.
/// @return true if connected, false if timeout reached.
bool WaitForCloudConnection(uint32_t timeout_ms = 60000);

}  // namespace pb::test
