# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Bazel rules for Particle on-device unit tests using pw_unit_test."""

load("@rules_cc//cc:defs.bzl", "cc_library")
load("@rules_shell//shell:sh_binary.bzl", "sh_binary")
load("//rules:particle_firmware.bzl", "particle_cc_binary", "particle_firmware_binary")

def particle_cc_test(
        name,
        srcs,
        deps = [],
        copts = [],
        defines = [],
        platform = "@particle_bazel//platforms/p2:particle_p2",
        **kwargs):
    """Creates an on-device Pigweed test for Particle devices.

    This macro creates a flashable test firmware that runs pw_unit_test
    on actual Particle hardware. Test output is sent via USB serial.

    Creates:
    - {name}.lib: Test library (alwayslink=1)
    - {name}.elf: Flashable ELF with test + main
    - {name}.bin: Flashable binary with CRC
    - {name}_flash: Target that flashes and opens serial monitor

    Args:
        name: Target name.
        srcs: Test source files.
        deps: Test dependencies.
        copts: Additional compiler flags.
        defines: Additional preprocessor defines.
        platform: Platform label (default: P2).
        **kwargs: Additional arguments (visibility, tags, etc.).
    """
    # Extract kwargs that apply to different target types
    common_kwargs = {k: v for k, v in kwargs.items()
                     if k in ["visibility", "tags", "testonly"]}

    # Test library (no main, just test code)
    cc_library(
        name = name + ".lib",
        srcs = srcs,
        deps = deps + ["@pigweed//pw_unit_test"],
        copts = copts,
        defines = defines,
        testonly = True,
        alwayslink = True,
        target_compatible_with = [
            "@pigweed//pw_build/constraints/arm:cortex-m33",
        ],
        **{k: v for k, v in common_kwargs.items() if k != "testonly"}
    )

    # Firmware with test main (particle_cc_binary adds Device OS deps)
    particle_cc_binary(
        name = name + ".elf",
        deps = [
            ":" + name + ".lib",
            "@particle_bazel//pw_unit_test_particle:main",
        ],
        platform = platform,
        testonly = True,
        **{k: v for k, v in common_kwargs.items() if k != "testonly"}
    )

    # Flashable binary with CRC
    particle_firmware_binary(
        name = name,
        elf = ":" + name + ".elf",
        testonly = True,
        **{k: v for k, v in common_kwargs.items() if k != "testonly"}
    )

    # Flash + run target (flashes then opens serial monitor)
    _particle_test_flash_binary(
        name = name + "_flash",
        firmware = ":" + name + ".bin",
        testonly = True,
        **{k: v for k, v in common_kwargs.items() if k != "testonly"}
    )

def _particle_test_flash_binary(
        name,
        firmware,
        **kwargs):
    """Creates a target that flashes test firmware and opens serial monitor."""
    sh_binary(
        name = name,
        srcs = ["@particle_bazel//rules:flash_test.sh"],
        data = [
            firmware,
            "@particle_bazel//rules:wait_for_device.sh",
        ],
        args = ["$(location " + firmware + ")"],
        tags = ["local"],  # Bypass sandbox for device access
        **kwargs
    )
