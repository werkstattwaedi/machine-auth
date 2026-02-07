# Claude Code Instructions for particle-bazel

## Copyright Header

All new source files (.cc, .h) MUST use this copyright header:

```cpp
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
```

For Python and Starlark files (.py, .bzl), use:

```python
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
```

For BUILD.bazel files, use:

```python
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
```

## Project Structure

This repository provides Pigweed backends for Particle Device OS:

- `pw_thread_particle/` - Thread backend using Device OS threading
- `pw_sync_particle/` - Synchronization primitives using Device OS semaphores/mutexes
- `pw_chrono_particle/` - Clock backend using Device OS time functions
- `pw_sys_io_particle/` - I/O backend using USB CDC serial
- `pw_assert_particle/` - Assert handler for Device OS
- `pw_digital_io_particle/` - Digital I/O using Device OS HAL
- `pw_stream_particle/` - UART stream using Device OS HAL (non-blocking)
- `pw_system_particle/` - pw_system integration (scheduler stub)
- `rules/` - Bazel rules for Particle firmware builds

## Python Tooling

The `tools/` directory contains Python libraries for Particle device operations:

### Modules

| Module | Target | Description |
|--------|--------|-------------|
| `tools.cli` | `@particle_bazel//tools:particle_cli_wrapper` | Hermetic particle-cli wrapper with retries |
| `tools.cloud` | `@particle_bazel//tools:particle_cloud` | Cloud REST API (devices, functions, variables, ledger) |
| `tools.usb` | `@particle_bazel//tools:particle_usb` | USB device operations (flash, reset, serial port detection) |
| Combined | `@particle_bazel//tools:particle_tools` | All modules combined |

### Entry Point Scripts

```bash
# Flash firmware to device
bazel run @particle_bazel//tools:flash_firmware -- /path/to/firmware.bin

# Wait for device to appear on USB
bazel run @particle_bazel//tools:wait_for_device

# Serial monitor
bazel run @particle_bazel//tools:serial_monitor
```

### Python Usage

```python
from tools.cloud import ParticleCloudClient, LedgerClient
from tools.cli import ParticleCli
from tools.usb import ParticleDevice, ParticleFlasher

# Cloud operations
with ParticleCloudClient() as client:
    devices = client.list_devices()
    result = client.call_function("my-device", "doSomething", "arg")
    value = client.get_variable("my-device", "temperature")

# Ledger operations
with LedgerClient() as ledger:
    data = ledger.get("my-device", "terminal-config")
    ledger.set("my-device", "terminal-config", {"enabled": True})

# USB flashing
flasher = ParticleFlasher()
device = flasher.flash_local("firmware.bin")
```

### Dependencies

- **Python packages**: `requests`, `pyserial` (managed via `requirements_lock.txt`)
- **particle-cli**: Hermetic npm package (via `pnpm-lock.yaml`)

## P2 Integration Tests

The `pb_integration_tests/` directory provides a framework for end-to-end testing on real P2 hardware. Each test defines its own `.py`, `main.cc`, and `.proto` files compiled into custom P2 firmware.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Python Test (pytest)                             │
├─────────────────────────────────────────────────────────────────────┤
│  IntegrationTestHarness                                              │
│  ├── Fixtures (pluggable)                                           │
│  │   ├── MockGatewayFixture (ASCON+HDLC TCP server)                 │
│  │   └── P2DeviceFixture (flash, serial RPC)                        │
│  └── RpcClient (pw_rpc over USB serial)                             │
└─────────────────────────────────────────────────────────────────────┘
        │                                    │
        │ RPC (USB serial/HDLC)              │ TCP (ASCON+HDLC)
        ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  P2 Device with Test Firmware                                        │
│  ├── Custom RPC services from test.proto                            │
│  └── Module under test → MockGateway (on host)                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Creating an Integration Test

Use the `pb_integration_test()` Bazel macro:

```python
# BUILD.bazel
load("@particle_bazel//pb_integration_tests/rules:integration_test.bzl", "pb_integration_test")

pb_integration_test(
    name = "my_feature_test",
    srcs = ["my_feature_test_main.cc"],
    proto = "my_feature_test.proto",
    test_py = "my_feature_test.py",
    firmware_deps = ["//path/to:module_under_test"],
)
```

This generates:
- `{name}_proto` - Proto library
- `{name}_pwpb` / `{name}_pwpb_rpc` - C++ proto libraries
- `{name}_py_proto` - Python proto library
- `{name}_firmware` - P2 firmware ELF
- `{name}_firmware.bin` - Flashable binary
- `{name}` - Python test target

### Test Components

**1. Proto file** - Define test-specific RPC services:

```protobuf
// my_feature_test.proto
syntax = "proto3";
package maco.test.myfeature;

import "pw_protobuf_protos/field_options.proto";

message ConfigureRequest {
  string param = 1 [(pw.protobuf.pwpb).max_size = 64];
}

message ConfigureResponse { bool success = 1; }

service TestControl {
  rpc Configure(ConfigureRequest) returns (ConfigureResponse);
  rpc TriggerOperation(...) returns (...);
}
```

**2. Firmware main** - Implement the service:

```cpp
// my_feature_test_main.cc
#include "my_feature_test.rpc.pwpb.h"
#include "pb_integration_tests/firmware/test_system.h"

namespace msgs = maco::test::myfeature::pwpb;
namespace svc = maco::test::myfeature::pw_rpc::pwpb;

class TestControlServiceImpl : public svc::TestControl::Service<TestControlServiceImpl> {
 public:
  pw::Status Configure(const msgs::ConfigureRequest::Message& request,
                       msgs::ConfigureResponse::Message& response) {
    // Store config, return success
    response.success = true;
    return pw::OkStatus();
  }
};

TestControlServiceImpl* g_service = nullptr;

void TestInit() {
  static TestControlServiceImpl service;
  g_service = &service;
  pb::test::GetRpcServer().RegisterService(service);
}

int main() {
  pb::test::TestSystemInit(TestInit);
}
```

**3. Python test** - Orchestrate fixtures and verify behavior:

```python
# my_feature_test.py
import pytest
from pb_integration_tests.harness import IntegrationTestHarness, P2DeviceFixture
from maco_gateway.fixtures import MockGatewayFixture
from pathlib import Path

@pytest.fixture
async def test_env():
    gateway = MockGatewayFixture()
    device = P2DeviceFixture(firmware_bin=Path("my_feature_test_firmware.bin.bin"))

    async with gateway, device:
        await device.rpc.TestControl.Configure(param=gateway.host)
        yield {"gateway": gateway, "device": device}

async def test_operation_succeeds(test_env):
    test_env["gateway"].set_forward_response("/endpoint", mock_response)
    result = await test_env["device"].rpc.TestControl.TriggerOperation(...)
    assert result.success
```

### Prerequisites

Integration tests require:
1. **P2 device** connected via USB
2. **particle-cli** installed globally: `npm install -g particle-cli`
3. **WiFi network** accessible by both host and P2 device (for gateway tests)

Tests are tagged `manual` and won't run automatically during normal `bazel test` runs.

### Running Tests

```bash
# Build firmware only (verify compilation)
bazel build --platforms=//maco_firmware/targets/p2:p2 //path/to:my_feature_test_firmware.bin

# Run test (requires hardware + particle-cli)
bazel test //path/to:my_feature_test
```

### Framework Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `pb_integration_tests/firmware/test_system.h` | Header | `GetRpcServer()` + `TestSystemInit()` API |
| `pb_integration_tests/firmware/test_system_p2.cc` | P2 impl | USB serial RPC transport |
| `pb_integration_tests/harness/` | Python | `IntegrationTestHarness`, `RpcClient`, fixtures |
| `pb_integration_tests/rules/integration_test.bzl` | Bazel | `pb_integration_test()` macro |
| `maco_gateway/fixtures/mock_gateway.py` | Python | `MockGatewayFixture` with ASCON transport |

### Example Test

See `maco_firmware/modules/firebase/integration_test/` for a complete example.

## Important Notes

- Device OS functions available to user applications are limited to those exported via dynalib
- Check `hal_dynalib_*.h` headers to verify function availability
- The FreeRTOS scheduler is already running when user code starts - don't call `vTaskStartScheduler`
