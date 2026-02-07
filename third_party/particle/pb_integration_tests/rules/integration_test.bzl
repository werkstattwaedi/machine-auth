# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Bazel rules for P2 integration tests.

This module provides the pb_integration_test() macro which creates:
- Proto libraries (C++ pwpb_rpc + Python pb2)
- P2 firmware binary with test-specific system
- Python test target with firmware as data dependency

Example:
    pb_integration_test(
        name = "firebase_client_test",
        srcs = ["firebase_client_test_main.cc"],
        proto = "firebase_client_test.proto",
        test_py = "firebase_client_test.py",
        firmware_deps = ["//maco_firmware/modules/firebase:firebase_client"],
        platform = "//maco_firmware/targets/p2:p2",
    )
"""

load("@com_google_protobuf//bazel:proto_library.bzl", "proto_library")
load("@com_google_protobuf//bazel:py_proto_library.bzl", "py_proto_library")
load(
    "@pigweed//pw_protobuf_compiler:pwpb_proto_library.bzl",
    "pwpb_proto_library",
)
load(
    "@pigweed//pw_protobuf_compiler:pwpb_rpc_proto_library.bzl",
    "pwpb_rpc_proto_library",
)
load("@rules_cc//cc:cc_library.bzl", "cc_library")
load("@rules_python//python:py_test.bzl", "py_test")
load("//rules:particle_firmware.bzl", "particle_cc_binary", "particle_firmware_binary")

def pb_integration_test(
        name,
        srcs,
        proto,
        test_py,
        firmware_deps = [],
        platform = "//maco_firmware/targets/p2:p2",
        proto_deps = [],
        test_deps = [],
        test_data = [],
        test_timeout = "long",
        **kwargs):
    """Creates a P2 integration test with custom proto services.

    This macro generates:
    - {name}_proto: Proto library
    - {name}_pwpb: C++ pwpb proto library (messages)
    - {name}_pwpb_rpc: C++ pwpb_rpc proto library (service stubs)
    - {name}_py_proto: Python proto library
    - {name}_firmware: P2 firmware binary (.elf)
    - {name}_firmware.bin: Flashable firmware binary
    - {name}: Python test target

    Args:
        name: Test name (used as base for all generated targets).
        srcs: C++ source files for the test firmware.
        proto: Proto file defining test-specific RPC services.
        test_py: Python test file.
        firmware_deps: Additional firmware dependencies.
        platform: P2 platform target.
        proto_deps: Additional proto dependencies (e.g., common protos).
        test_deps: Additional Python test dependencies.
        test_data: Additional test data files.
        test_timeout: Test timeout (default: "long").
        **kwargs: Additional arguments (visibility, tags, etc.).
    """
    # Extract common kwargs
    visibility = kwargs.pop("visibility", None)
    tags = kwargs.pop("tags", [])

    # Default proto deps (for field options)
    default_proto_deps = [
        "@pigweed//pw_protobuf:field_options_proto",
    ]

    # Create proto library
    proto_name = name + "_proto"
    proto_library(
        name = proto_name,
        srcs = [proto],
        deps = proto_deps + default_proto_deps,
        visibility = visibility,
    )

    # Create C++ pwpb proto library (messages)
    pwpb_name = name + "_pwpb"
    pwpb_proto_library(
        name = pwpb_name,
        deps = [":" + proto_name],
        visibility = visibility,
    )

    # Create C++ pwpb_rpc proto library (service stubs)
    pwpb_rpc_name = name + "_pwpb_rpc"
    pwpb_rpc_proto_library(
        name = pwpb_rpc_name,
        pwpb_proto_library_deps = [":" + pwpb_name],
        deps = [":" + proto_name],
        visibility = visibility,
    )

    # Create Python proto library
    py_proto_name = name + "_py_proto"
    py_proto_library(
        name = py_proto_name,
        deps = [":" + proto_name],
        visibility = visibility,
    )

    # Create firmware library with test sources
    firmware_lib_name = name + "_lib"
    cc_library(
        name = firmware_lib_name,
        srcs = srcs,
        deps = firmware_deps + [
            ":" + pwpb_rpc_name,
            "@particle_bazel//pb_integration_tests/firmware:test_system_p2",
            "@pigweed//pw_log",
        ],
        alwayslink = True,
        target_compatible_with = ["@pigweed//pw_build/constraints/arm:cortex-m33"],
        visibility = visibility,
    )

    # Create firmware ELF binary
    firmware_elf_name = name + "_firmware"
    particle_cc_binary(
        name = firmware_elf_name,
        deps = [":" + firmware_lib_name],
        platform = platform,
        visibility = visibility,
    )

    # Create flashable .bin
    firmware_bin_name = name + "_firmware.bin"
    particle_firmware_binary(
        name = firmware_bin_name,
        elf = ":" + firmware_elf_name,
        visibility = visibility,
    )

    # Create Python test
    py_test(
        name = name,
        srcs = [test_py],
        main = test_py,
        deps = [
            ":" + py_proto_name,
            "@particle_bazel//pb_integration_tests/harness",
            "//maco_gateway:gateway_lib",
        ] + test_deps,
        data = [
            ":" + firmware_bin_name + ".bin",
            proto,  # Include proto file for RpcClient
            # Note: particle-cli must be on system PATH (npm install -g particle-cli)
        ] + test_data,
        timeout = test_timeout,
        tags = ["local", "exclusive", "manual"] + tags,  # local for USB, exclusive to avoid conflicts, manual requires hardware
        visibility = visibility,
    )
