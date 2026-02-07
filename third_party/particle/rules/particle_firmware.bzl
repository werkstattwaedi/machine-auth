# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Bazel rules for building Particle P2 firmware with two-pass linking.

This module implements two-pass linking for accurate OTA-compatible module
boundaries, matching Particle's Make-based build system behavior.
"""

load("@bazel_tools//tools/build_defs/cc:action_names.bzl", "ACTION_NAMES")
load("@bazel_tools//tools/cpp:toolchain_utils.bzl", "find_cpp_toolchain", "use_cpp_toolchain")
load("@rules_cc//cc:defs.bzl", "cc_binary", "cc_library")
load("@rules_cc//cc/common:cc_common.bzl", "cc_common")
load("@rules_cc//cc/common:cc_info.bzl", "CcInfo")
load("@pigweed//pw_build:binary_tools.bzl", "pw_elf_to_bin")
load("@pigweed//pw_toolchain/action:action_names.bzl", "PW_ACTION_NAMES")

# Platform: P2 (RTL8721DM / Cortex-M33)
PARTICLE_P2_PLATFORM_ID = 32
PARTICLE_P2_PLATFORM_NAME = "p2"
PARTICLE_P2_PLATFORM_GEN = 3

# Device OS version
DEVICE_OS_VERSION = 6304  # 6.3.4

# Particle-specific compiler flags
PARTICLE_COPTS = [
    "-flto",
    "-ffat-lto-objects",
    # Relax warnings for Device OS code
    "-Wno-redundant-decls",
    "-Wno-switch",
    "-Wno-unused-parameter",
    "-Wno-cast-qual",
    "-Wno-missing-field-initializers",
]

# Base linker flags (without memory-specific linker script)
# Note: Paths are relative to Bazel execroot where particle-bazel is at "external/particle_bazel+/"
PARTICLE_BASE_LINKOPTS = [
    # Cortex-M33 architecture flags (must match compilation)
    "-mcpu=cortex-m33",
    "-mthumb",
    "-mfloat-abi=hard",
    "-mfpu=fpv5-sp-d16",
    "--specs=nano.specs",
    "--specs=nosys.specs",
    # Linker scripts and library paths
    "-Texternal/particle_bazel+/third_party/device-os/modules/tron/user-part/linker.ld",
    "-Lexternal/particle_bazel+/rules",  # For memory_platform_user.ld defaults
    "-Lexternal/particle_bazel+/third_party/device-os/modules/tron/user-part",
    "-Lexternal/particle_bazel+/third_party/device-os/modules/tron/system-part1",
    "-Lexternal/particle_bazel+/third_party/device-os/modules/shared/rtl872x",
    "-Lexternal/particle_bazel+/third_party/device-os/build/arm/linker",
    "-Lexternal/particle_bazel+/third_party/device-os/build/arm/linker/rtl872x",
    "-Wl,--defsym,__STACKSIZE__=8192",
    "-Wl,--defsym,__STACK_SIZE=8192",
    # Force linker to include user entry points
    "-Wl,--undefined=setup",
    "-Wl,--undefined=loop",
    "-Wl,--undefined=module_user_init_hook",
    "-Wl,--undefined=_post_loop",
    "-Wl,--gc-sections",
    "-Wl,--build-id",  # Generate GNU build ID
    "-Wl,--no-warn-rwx-segment",  # Suppress RWX segment warnings
    "-nostartfiles",
    "-fno-lto",  # Disable LTO at link time (as per Particle build)
    "-lnosys",
    "-lc",
    "-lm",
    "-lstdc++",
]

# Platform transition for building under a specific platform
def _particle_platform_transition_impl(settings, attr):
    """Transition to build deps under the specified platform."""
    if hasattr(attr, "platform") and attr.platform:
        return {"//command_line_option:platforms": str(attr.platform)}
    return {}

_particle_platform_transition = transition(
    implementation = _particle_platform_transition_impl,
    inputs = [],
    outputs = ["//command_line_option:platforms"],
)

def _particle_two_pass_binary_impl(ctx):
    """Implementation of two-pass linking for Particle firmware.

    Pass 1: Link with conservative defaults to create intermediate ELF
    Pass 2: Extract sizes, generate precise linker script, re-link final ELF
    """
    # Get toolchain from the transitioned _cc_toolchain attribute
    # This resolves the toolchain in the target (ARM) configuration, not exec (host)
    # With transitions, the attribute returns a list - get the first (and only) element
    cc_toolchain = ctx.attr._cc_toolchain[0][cc_common.CcToolchainInfo]
    feature_configuration = cc_common.configure_features(
        ctx = ctx,
        cc_toolchain = cc_toolchain,
        requested_features = ctx.features,
        unsupported_features = ctx.disabled_features,
    )

    # Get toolchain paths
    linker_path = cc_common.get_tool_for_action(
        feature_configuration = feature_configuration,
        action_name = ACTION_NAMES.cpp_link_executable,
    )
    objdump_path = cc_common.get_tool_for_action(
        feature_configuration = feature_configuration,
        action_name = PW_ACTION_NAMES.objdump_disassemble,
    )

    # Collect static libraries and user link flags from deps
    # NOTE: We deliberately DO NOT collect raw .o files because different cc_library
    # targets can compile the same source file into different .o files (e.g., both
    # modules/blinky:nanopb and modules/board:nanopb compile common.pb.c). Collecting
    # all .o files would cause multiple definition errors. Instead, we link only the
    # .a archives and use --whole-archive for alwayslink libraries.
    seen_libs = {}  # path -> File, for deduplication
    alwayslink_libs = []  # Libraries that need --whole-archive
    regular_libs = []  # Regular libraries
    user_link_flags = []  # Additional linker flags (e.g., -T for linker scripts)
    additional_linker_inputs = []  # Files needed by user_link_flags
    for dep in ctx.attr.deps:
        if CcInfo in dep:
            cc_info = dep[CcInfo]
            for li in cc_info.linking_context.linker_inputs.to_list():
                # Collect user link flags (e.g., -T linker_script.ld from pw_linker_script)
                user_link_flags.extend(li.user_link_flags)
                additional_linker_inputs.extend(li.additional_inputs)
                for lib in li.libraries:
                    static_lib = lib.static_library or lib.pic_static_library
                    if static_lib and static_lib.path not in seen_libs:
                        seen_libs[static_lib.path] = static_lib
                        if lib.alwayslink:
                            alwayslink_libs.append(static_lib)
                        else:
                            regular_libs.append(static_lib)

    # Combine all libraries (alwayslink first, then regular)
    linker_inputs = alwayslink_libs + regular_libs

    # Collect linker scripts
    linker_script_files = []
    for f in ctx.files._linker_scripts:
        linker_script_files.append(f)

    # Output files
    intermediate_elf = ctx.actions.declare_file(ctx.attr.name + "_intermediate.elf")
    sizes_json = ctx.actions.declare_file(ctx.attr.name + "_sizes.json")
    # Name must match what linker.ld includes: "memory_platform_user.ld"
    # Put in subdirectory so we can add it first in -L search path
    precise_ld = ctx.actions.declare_file(ctx.attr.name + "_generated/memory_platform_user.ld")
    final_elf = ctx.actions.declare_file(ctx.attr.name)

    # Build linker flags for first pass (with defaults from memory_platform_user.ld)
    base_linkopts = PARTICLE_BASE_LINKOPTS
    user_linkopts = ctx.attr.linkopts

    # Pass 2 flags: put generated memory_platform_user.ld directory FIRST
    # so it overrides the defaults when linker.ld does INCLUDE memory_platform_user.ld
    pass2_linkopts = ["-L" + precise_ld.dirname] + PARTICLE_BASE_LINKOPTS

    # Build library flags using full paths (avoids -L/-l: search path issues)
    # Use --whole-archive for alwayslink libs to ensure all symbols are included
    alwayslink_flags = []
    for lib in alwayslink_libs:
        alwayslink_flags.append("-Wl,--whole-archive")
        alwayslink_flags.append(lib.path)
        alwayslink_flags.append("-Wl,--no-whole-archive")

    regular_flags = [l.path for l in regular_libs]
    library_flags = " ".join(alwayslink_flags + regular_flags)

    # Combine all linker flags (base + user-specified + deps' user_link_flags)
    all_linkopts = base_linkopts + user_linkopts + user_link_flags
    all_linkopts_pass2 = pass2_linkopts + user_linkopts + user_link_flags

    # Create the two-pass linking script
    # We use run_shell because we need to execute two linking steps with
    # dynamic generation of the linker script between them
    script = """
set -e

# === PASS 1: Link with defaults ===
echo "Pass 1: Linking with default memory values..."
{linker} {linker_flags} {libraries} -o {intermediate_elf}

# === Extract sizes from intermediate ELF ===
echo "Extracting section sizes..."
python3 {extract_script} \
    --objdump {objdump} \
    --elf {intermediate_elf} \
    --output-json {sizes_json} \
    --output-ld {precise_ld}

# === PASS 2: Re-link with precise values ===
echo "Pass 2: Re-linking with precise memory values..."
{linker} {linker_flags_pass2} {libraries} -o {final_elf}

echo "Two-pass linking complete."
""".format(
        linker = linker_path,
        extract_script = ctx.file._extract_sizes.path,
        objdump = objdump_path,
        linker_flags = " ".join(all_linkopts),
        linker_flags_pass2 = " ".join(all_linkopts_pass2),
        libraries = library_flags,
        intermediate_elf = intermediate_elf.path,
        sizes_json = sizes_json.path,
        precise_ld = precise_ld.path,
        final_elf = final_elf.path,
    )

    ctx.actions.run_shell(
        outputs = [intermediate_elf, sizes_json, precise_ld, final_elf],
        inputs = depset(
            direct = linker_inputs + linker_script_files + list(additional_linker_inputs) + [ctx.file._extract_sizes],
            transitive = [cc_toolchain.all_files],
        ),
        command = script,
        mnemonic = "ParticleTwoPassLink",
        progress_message = "Two-pass linking %{label}",
        use_default_shell_env = True,
    )

    return [
        DefaultInfo(
            files = depset([final_elf, sizes_json]),
            executable = final_elf,
        ),
    ]

_particle_two_pass_binary = rule(
    implementation = _particle_two_pass_binary_impl,
    attrs = {
        "deps": attr.label_list(
            providers = [CcInfo],
            cfg = _particle_platform_transition,  # Apply platform transition to deps
        ),
        "linkopts": attr.string_list(default = []),
        "platform": attr.label(),  # Platform for transition
        "_linker_scripts": attr.label(
            default = "@particle_bazel//:linker_scripts",
        ),
        "_extract_sizes": attr.label(
            default = "@particle_bazel//tools:extract_elf_sizes.py",
            allow_single_file = True,
        ),
        "_cc_toolchain": attr.label(
            default = "@bazel_tools//tools/cpp:current_cc_toolchain",
            cfg = _particle_platform_transition,  # Get toolchain from target platform
        ),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
    executable = True,
    toolchains = use_cpp_toolchain(),
    fragments = ["cpp"],
)

def particle_cc_binary(
        name,
        srcs = [],
        deps = [],
        copts = [],
        defines = [],
        linkopts = [],
        platform = None,
        two_pass = True,
        **kwargs):
    """Creates a Particle P2 firmware binary.

    This macro creates a firmware binary with proper two-pass linking for
    OTA-compatible module boundaries. It wraps cc_binary/cc_library with
    all the Particle-specific compiler flags, linker scripts, and
    dependencies needed to build a user firmware module.

    Args:
        name: Target name. Should end with .elf for clarity.
        srcs: Source files for the firmware.
        deps: Dependencies (user libraries).
        copts: Additional compiler flags.
        defines: Additional preprocessor defines.
        linkopts: Additional linker flags.
        platform: Platform label for transition (e.g., "@particle_bazel//platforms/p2:particle_p2").
        two_pass: If True (default), use two-pass linking for precise memory.
                  If False, use single-pass with static defaults.
        **kwargs: Additional arguments passed to the underlying rules.
    """
    # Create a library with the firmware sources
    lib_name = name + "_lib"
    cc_library(
        name = lib_name,
        srcs = srcs,
        deps = deps + [
            "@particle_bazel//:device_os_user_part",
            "@pigweed//pw_assert_basic",
            "@pigweed//pw_assert_basic:impl",  # Provides pw_assert_basic_HandleFailure
            "@particle_bazel//pw_assert_particle:handler",  # Provides the actual handler
        ],
        copts = PARTICLE_COPTS + copts,
        defines = defines,
        alwayslink = True,
        target_compatible_with = ["@pigweed//pw_build/constraints/arm:cortex-m33"],
        **{k: v for k, v in kwargs.items() if k not in ["visibility"]}
    )

    if two_pass:
        # Use two-pass linking for precise memory boundaries
        _particle_two_pass_binary(
            name = name,
            deps = [":" + lib_name],
            linkopts = linkopts,
            platform = platform,
            **{k: v for k, v in kwargs.items() if k in ["visibility", "tags", "testonly"]}
        )
    else:
        # Fallback: single-pass linking with static defaults
        particle_linkopts = PARTICLE_BASE_LINKOPTS + [
            "-Lexternal/particle_bazel+/rules",  # For memory_platform_user.ld
        ]
        cc_binary(
            name = name,
            deps = [":" + lib_name],
            additional_linker_inputs = [
                "@particle_bazel//:linker_scripts",
            ],
            linkopts = particle_linkopts + linkopts,
            target_compatible_with = ["@pigweed//pw_build/constraints/arm:cortex-m33"],
            **{k: v for k, v in kwargs.items() if k in ["visibility", "tags", "testonly"]}
        )

def particle_firmware_binary(
        name,
        elf,
        **kwargs):
    """Creates a flashable .bin from an ELF with SHA256/CRC32 patched.

    Args:
        name: Target name for the .bin file.
        elf: Label of the ELF file to convert.
        **kwargs: Additional arguments passed to genrule.
    """
    # Use Pigweed's pw_elf_to_bin for proper toolchain integration
    bin_name = name + "_raw"
    pw_elf_to_bin(
        name = bin_name,
        elf_input = elf,
        bin_out = bin_name + ".bin",
        testonly = kwargs.get("testonly", False),
    )

    # Patch SHA256 and CRC32 into the binary
    # Note: This runs on host (not target), so no target_compatible_with
    native.genrule(
        name = name,
        srcs = [":" + bin_name + ".bin"],
        outs = [name + ".bin"],
        cmd = """
            cp $< $@
            chmod +w $@
            python3 $(location @particle_bazel//tools:particle_crc) $@
        """,
        tools = ["@particle_bazel//tools:particle_crc"],
        **kwargs
    )

def particle_flash_binary(
        name,
        firmware,
        **kwargs):
    """Creates a target to flash firmware to a Particle device.

    Usage: bazel run //path/to:{name}

    Args:
        name: Target name.
        firmware: Label of the firmware binary (.bin) to flash.
        **kwargs: Additional arguments (visibility, testonly).
    """
    native.py_binary(
        name = name,
        srcs = ["@particle_bazel//tools:scripts/flash_firmware.py"],
        main = "@particle_bazel//tools:scripts/flash_firmware.py",
        data = [firmware],
        deps = [
            "@particle_bazel//tools:particle_cli_wrapper",
            "@particle_bazel//tools:particle_usb",
        ],
        args = ["$(location " + firmware + ")"],
        tags = ["local"],  # Bypass sandbox to access USB devices
        **{k: v for k, v in kwargs.items() if k in ["visibility", "testonly"]}
    )

def particle_firmware(
        name,
        srcs = [],
        deps = [],
        copts = [],
        defines = [],
        linkopts = [],
        platform = None,
        two_pass = True,
        **kwargs):
    """Creates a complete Particle firmware with ELF and flashable .bin.

    This is a convenience macro that creates both:
    - {name} - The linked ELF binary (default target for development/IDE)
    - {name}.bin - The flashable binary with CRC patched (for flashing)

    The ELF is the default because it's what you build during development
    and it generates proper compile commands for IDE support.

    Args:
        name: Target name (without extension).
        srcs: Source files for the firmware.
        deps: Dependencies (user libraries).
        copts: Additional compiler flags.
        defines: Additional preprocessor defines.
        linkopts: Additional linker flags.
        platform: Platform label for transition (e.g., "@particle_bazel//platforms/p2:particle_p2").
        two_pass: If True (default), use two-pass linking for precise memory.
        **kwargs: Additional arguments passed to underlying rules.
    """
    # Create the ELF binary as the default target
    particle_cc_binary(
        name = name,
        srcs = srcs,
        deps = deps,
        copts = copts,
        defines = defines,
        linkopts = linkopts,
        platform = platform,
        two_pass = two_pass,
        **{k: v for k, v in kwargs.items() if k not in ["visibility"]}
    )

    # Create the flashable .bin
    bin_name = name + ".bin"
    particle_firmware_binary(
        name = bin_name,
        elf = ":" + name,
        **{k: v for k, v in kwargs.items() if k in ["visibility", "tags", "testonly"]}
    )
