# Particle Python Tools

Python libraries for Particle device operations with hermetic builds via Bazel.

## Quick Start

```bash
# Flash firmware to device
bazel run @particle_bazel//tools:flash_firmware -- /path/to/firmware.bin

# Wait for device to appear on USB
bazel run @particle_bazel//tools:wait_for_device

# Serial monitor
bazel run @particle_bazel//tools:serial_monitor
```

## Modules

### CLI Wrapper (`tools.cli`)

Hermetic particle-cli wrapper with retry logic and error handling.

```python
from tools.cli import ParticleCli

cli = ParticleCli()

# Run any particle command
result = cli.run(["version"])

# With retry for flaky commands
result = cli.run_with_retry(["usb", "cloud-status", "my-device"])

# Convenience methods
cli.flash_local("firmware.bin")
cli.usb_reset()
status = cli.usb_cloud_status("my-device")
result = cli.call_function("my-device", "doSomething", "arg")
```

### Cloud API (`tools.cloud`)

REST API client for Particle Cloud operations.

```python
from tools.cloud import ParticleCloudClient, LedgerClient

# Requires PARTICLE_ACCESS_TOKEN environment variable
# Get a token via: particle token create

# Device operations
with ParticleCloudClient() as client:
    devices = client.list_devices()
    device = client.get_device("my-device")
    result = client.call_function("my-device", "doSomething", "arg")
    value = client.get_variable("my-device", "temperature")
    client.publish_event("test/event", "data")

# Ledger operations
with LedgerClient() as ledger:
    data = ledger.get("my-device", "terminal-config")
    ledger.set("my-device", "terminal-config", {"enabled": True})
    ledger.delete("my-device", "terminal-config")
```

### Event Subscription (`tools.cloud.events`)

Server-Sent Events (SSE) subscription for real-time events.

```python
from tools.cloud import EventSubscription

with EventSubscription("test/", device="my-device") as sub:
    # Wait for a specific event
    event = sub.wait_for_event(timeout=10)
    if event:
        print(f"Got {event.name}: {event.data}")

    # Or iterate over events
    for event in sub.iter_events(timeout=1.0):
        print(event)
```

### USB Operations (`tools.usb`)

USB device detection, flashing, and serial port management.

```python
from tools.usb import (
    list_particle_ports,
    wait_for_serial_port,
    ParticleDevice,
    ParticleFlasher,
)

# Find connected devices
ports = list_particle_ports()
for port in ports:
    print(f"{port.port}: {port.device_type} ({port.serial_number})")

# Wait for device
port = wait_for_serial_port(timeout=15.0)

# Device operations
device = ParticleDevice.find(timeout=10.0)
device.flash("firmware.bin")
device.reset()
if device.is_cloud_connected():
    print("Connected to cloud!")

# Flashing with verification
flasher = ParticleFlasher()
device = flasher.flash_and_verify(
    "firmware.bin",
    wait_for_cloud=True,
    cloud_timeout=60.0,
)
```

## Bazel Targets

| Target | Type | Description |
|--------|------|-------------|
| `@particle_bazel//tools:particle_cli_wrapper` | `py_library` | CLI wrapper module |
| `@particle_bazel//tools:particle_cloud` | `py_library` | Cloud API module |
| `@particle_bazel//tools:particle_usb` | `py_library` | USB operations module |
| `@particle_bazel//tools:particle_tools` | `py_library` | Combined library |
| `@particle_bazel//tools:flash_firmware` | `py_binary` | Flash script |
| `@particle_bazel//tools:wait_for_device` | `py_binary` | Wait for device script |
| `@particle_bazel//tools:serial_monitor` | `py_binary` | Serial monitor script |

## Environment Variables

- `PARTICLE_ACCESS_TOKEN` - API access token for cloud operations (get via `particle token create`)
- `RUNFILES_DIR` - Bazel runfiles directory (set automatically by Bazel)

## Dependencies

- **Python packages**: `requests`, `pyserial` (defined in `requirements_lock.txt`)
- **particle-cli**: Hermetic npm package (defined in `pnpm-lock.yaml`)

## Development

Run tests:

```bash
bazel test @particle_bazel//tools:test_cloud_client @particle_bazel//tools:test_cli_wrapper
```

Update Python dependencies:

```bash
# Edit requirements.txt, then regenerate lock file
pip-compile requirements.txt -o requirements_lock.txt
```

Update particle-cli:

```bash
# Edit package.json, then regenerate lock file
cd third_party/particle/tools
pnpm install
rm -rf node_modules  # Not needed in git
```
