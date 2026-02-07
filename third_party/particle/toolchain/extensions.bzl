# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Module extension for ARM GCC toolchain."""

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

def _arm_toolchain_impl(ctx):
    http_archive(
        name = "gcc_arm_none_eabi_toolchain",
        urls = ["https://developer.arm.com/-/media/Files/downloads/gnu-rm/10-2020q4/gcc-arm-none-eabi-10-2020-q4-major-x86_64-linux.tar.bz2"],
        strip_prefix = "gcc-arm-none-eabi-10-2020-q4-major",
        build_file = "//toolchain:gcc_arm_none_eabi.BUILD",
        # SHA256 will be computed on first fetch - Bazel will tell us the correct value
        sha256 = "21134caa478bbf5352e239fbc6e2da3038f8d2207e089efc96c3b55f1571571a",
    )

arm_toolchain = module_extension(
    implementation = _arm_toolchain_impl,
)
