# ADR-0011: pw_console with Tokenized Logging and RPC

**Status:** Accepted

**Date:** 2026-01-09

**Applies to:** `maco_firmware/` (Pigweed + Bazel)

## Context

maco_firmware currently uses `pw_log_basic` for logging, which outputs plain text over USB CDC Serial. While functional for basic debugging, this approach has limitations:

1. **Binary size**: Full log strings are stored in flash, consuming significant space
2. **Bandwidth**: Complete strings transmitted over serial, limiting throughput
3. **No remote interaction**: Cannot query device state or trigger operations remotely
4. **Limited tooling**: No structured log filtering, searching, or persistent history

The project already has pw_system partially integrated (channel setup, `StartAndClobberTheStack`), and the tokenizer linker script is included in `extra_platform_libs`. The infrastructure for a more sophisticated debugging setup exists but isn't fully utilized.

### Requirements

- Reduce flash/bandwidth usage for logging (embedded constraint)
- Enable interactive device debugging via host console
- Support RPC for device state queries and commands
- Work on both P2 hardware and host simulator
- Minimal initial scope, extensible for future needs

## Decision

Integrate **pw_console** with **pw_log_tokenized** and **pw_rpc** to create a complete development and debugging workflow.

### Components

| Component | Purpose |
|-----------|---------|
| **pw_log_tokenized** | Replace pw_log_basic; compress log strings to 4-byte tokens |
| **pw_system:log_backend** | Handler that routes tokenized logs to MultiSink/RPC |
| **Token database** | CSV mapping tokens→strings, extracted from ELF |
| **pw_rpc MacoService** | Custom RPC service for device operations |
| **pw_console script** | Python tool for log viewing and RPC interaction |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEVICE (P2 / Host)                           │
├─────────────────────────────────────────────────────────────────┤
│  PW_LOG_INFO("msg")                                             │
│         │                                                       │
│         ▼                                                       │
│  pw_log_tokenized  ──────►  pw_system:log_backend              │
│  (4-byte token)             (MultiSink → RPC LogService)       │
│                                                                 │
│  MacoService ◄──────────────► pw_rpc Server                    │
│  (Echo, GetDeviceInfo)                                         │
│                     │                                           │
│                     ▼                                           │
│              pw_hdlc (framing)                                  │
│                     │                                           │
└─────────────────────┼───────────────────────────────────────────┘
                      │ USB CDC Serial
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    HOST (pw_console)                            │
├─────────────────────────────────────────────────────────────────┤
│  pw_hdlc decoder                                                │
│         │                                                       │
│         ├──► Detokenizer (tokens.csv) ──► Log Viewer           │
│         │                                                       │
│         └──► RPC Client ──► Python REPL                        │
│                            device.rpcs.maco.MacoService.Echo() │
└─────────────────────────────────────────────────────────────────┘
```

### Initial RPC Service

Start minimal with two methods:

```protobuf
service MacoService {
  rpc Echo(EchoMessage) returns (EchoMessage);
  rpc GetDeviceInfo(pw.protobuf.Empty) returns (DeviceInfoResponse);
}
```

Additional app-specific operations (NFC control, state management) can be added incrementally.

### Files to Create

| Path | Purpose |
|------|---------|
| `maco_firmware/protos/maco_service.proto` | RPC service definition |
| `maco_firmware/protos/BUILD.bazel` | Proto compilation |
| `maco_firmware/services/maco_service.{h,cc}` | Service implementation |
| `maco_firmware/services/BUILD.bazel` | Service library |
| `tools/console.py` | pw_console wrapper script |
| `tools/BUILD.bazel` | Console Bazel target |

### Files to Modify

| Path | Change |
|------|--------|
| `maco_firmware/targets/p2/BUILD.bazel` | Switch to pw_log_tokenized backend |
| `maco_firmware/targets/host/BUILD.bazel` | Same backend switch |
| `maco_firmware/targets/*/system.cc` | Register MacoService with RPC server |
| `maco_firmware/apps/dev/BUILD.bazel` | Add token database generation |

## Consequences

**Pros:**

- ~80% reduction in log string flash usage
- Reduced serial bandwidth (tokens + varints vs full strings)
- Interactive debugging via Python REPL
- Structured log filtering/searching in pw_console
- Foundation for future RPC operations (NFC, state, diagnostics)
- Consistent behavior on P2 and host simulator

**Cons:**

- Requires token database on host for log readability
- Token database must be regenerated when log strings change
- Additional build complexity (proto compilation, database generation)
- Host simulator needs virtual serial or socket for console connection

**Tradeoffs:**

- **Rejected separate HDLC channel for logs** - RPC LogService is simpler and integrates with pw_console natively
- **Rejected pw_log_basic for host** - Consistency between platforms aids debugging; detokenization handles readability
- **Rejected comprehensive initial RPC scope** - Start minimal, add operations as needs arise

## References

- [pw_log_tokenized documentation](https://pigweed.dev/pw_log_tokenized/)
- [pw_console documentation](https://pigweed.dev/pw_console/)
- [pw_rpc documentation](https://pigweed.dev/pw_rpc/)
- ADR-0003: Bazel/Pigweed Build System
- Implementation plan: `.claude/plans/binary-chasing-raven.md`
