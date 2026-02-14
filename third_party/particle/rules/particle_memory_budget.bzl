# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Bazel rule for P2 firmware memory budget analysis.

Analyzes a firmware ELF, prints a detailed memory breakdown, and fails
when any section exceeds its configured budget limit.

Usage in BUILD.bazel:
    load("@particle_bazel//rules:particle_memory_budget.bzl", "particle_memory_budget")

    particle_memory_budget(
        name = "memory_budget",
        elf = ":factory",
        sram_limit = 100000,
        psram_limit = 300000,
        flash_limit = 320000,
    )

Commands:
    bazel test //path/to:memory_budget                    # Check limits
    UPDATE_GOLDENS=1 bazel run //path/to:memory_budget    # Update golden
"""

load("@bazel_tools//tools/cpp:toolchain_utils.bzl", "use_cpp_toolchain")
load("@rules_cc//cc/common:cc_common.bzl", "cc_common")
load("@pigweed//pw_toolchain/action:action_names.bzl", "PW_ACTION_NAMES")

# Platform transition to resolve the ARM toolchain for objdump.
# Same pattern as _particle_platform_transition in particle_firmware.bzl.
def _arm_platform_transition_impl(settings, attr):
    if hasattr(attr, "platform") and attr.platform:
        return {"//command_line_option:platforms": str(attr.platform)}
    return {}

_arm_platform_transition = transition(
    implementation = _arm_platform_transition_impl,
    inputs = [],
    outputs = ["//command_line_option:platforms"],
)

def _memory_budget_test_impl(ctx):
    """Implementation of memory budget test rule."""
    # Find the ELF file from the target's outputs (skip .json sidecar)
    elf_file = None
    for f in ctx.files.elf:
        if not f.path.endswith(".json"):
            elf_file = f
            break
    if not elf_file:
        fail("Could not find ELF file in outputs of %s" % ctx.attr.elf)

    # Resolve ARM objdump from the CC toolchain transitioned to ARM platform
    cc_toolchain = ctx.attr._cc_toolchain[0][cc_common.CcToolchainInfo]
    feature_configuration = cc_common.configure_features(
        ctx = ctx,
        cc_toolchain = cc_toolchain,
        requested_features = ctx.features,
        unsupported_features = ctx.disabled_features,
    )
    objdump_path = cc_common.get_tool_for_action(
        feature_configuration = feature_configuration,
        action_name = PW_ACTION_NAMES.objdump_disassemble,
    )

    # Build the test script
    golden_arg = ""
    if ctx.file.golden:
        golden_arg = "--golden " + ctx.file.golden.short_path

    script_content = """\
#!/bin/bash
set -e

# When run via 'bazel run' with UPDATE_GOLDENS, pass workspace dir
if [ -n "${{UPDATE_GOLDENS:-}}" ] && [ -n "${{BUILD_WORKSPACE_DIRECTORY:-}}" ]; then
    export BUILD_WORKSPACE_DIRECTORY
fi

exec python3 {script} \\
    --objdump {objdump} \\
    --elf {elf_file} \\
    --sram-limit {sram_limit} \\
    --psram-limit {psram_limit} \\
    --flash-limit {flash_limit} \\
    {golden_arg}
""".format(
        script = ctx.file._memory_budget_script.short_path,
        objdump = objdump_path,
        elf_file = elf_file.short_path,
        sram_limit = ctx.attr.sram_limit,
        psram_limit = ctx.attr.psram_limit,
        flash_limit = ctx.attr.flash_limit,
        golden_arg = golden_arg,
    )

    # Write the test runner script
    test_script = ctx.actions.declare_file(ctx.attr.name + "_test.sh")
    ctx.actions.write(
        output = test_script,
        content = script_content,
        is_executable = True,
    )

    # Collect runfiles
    runfiles_files = [
        ctx.file._memory_budget_script,
        elf_file,
    ]
    if ctx.file.golden:
        runfiles_files.append(ctx.file.golden)

    runfiles = ctx.runfiles(
        files = runfiles_files,
        transitive_files = cc_toolchain.all_files,
    )

    return [
        DefaultInfo(
            executable = test_script,
            runfiles = runfiles,
        ),
    ]

_memory_budget_test = rule(
    implementation = _memory_budget_test_impl,
    test = True,
    attrs = {
        "elf": attr.label(
            mandatory = True,
            allow_files = True,
            doc = "The firmware ELF to analyze",
        ),
        "platform": attr.label(
            doc = "ARM platform label for resolving the correct objdump",
        ),
        "sram_limit": attr.int(
            default = 0,
            doc = "SRAM budget limit in bytes (0 = no limit)",
        ),
        "psram_limit": attr.int(
            default = 0,
            doc = "PSRAM budget limit in bytes (0 = no limit)",
        ),
        "flash_limit": attr.int(
            default = 0,
            doc = "Flash budget limit in bytes (0 = no limit)",
        ),
        "golden": attr.label(
            allow_single_file = True,
            doc = "Golden baseline file for diff on failure",
        ),
        "_memory_budget_script": attr.label(
            default = "@particle_bazel//tools:memory_budget.py",
            allow_single_file = True,
        ),
        "_cc_toolchain": attr.label(
            default = "@bazel_tools//tools/cpp:current_cc_toolchain",
            cfg = _arm_platform_transition,
        ),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
    toolchains = use_cpp_toolchain(),
    fragments = ["cpp"],
)

def particle_memory_budget(
        name,
        elf,
        platform = "@particle_bazel//platforms/p2:particle_p2",
        sram_limit = 0,
        psram_limit = 0,
        flash_limit = 0,
        golden = None,
        **kwargs):
    """Creates a memory budget test for a Particle firmware ELF.

    Analyzes the ELF, prints a detailed report, and fails if any
    region exceeds the configured budget limit.

    Args:
        name: Target name.
        elf: Label of the firmware ELF to analyze.
        platform: ARM platform label for toolchain resolution.
        sram_limit: SRAM budget limit in bytes (0 = no limit).
        psram_limit: PSRAM budget limit in bytes (0 = no limit).
        flash_limit: Flash budget limit in bytes (0 = no limit).
        golden: Label of golden baseline file (optional).
        **kwargs: Additional arguments (visibility, tags, etc.).
    """
    _memory_budget_test(
        name = name,
        elf = elf,
        platform = platform,
        sram_limit = sram_limit,
        psram_limit = psram_limit,
        flash_limit = flash_limit,
        golden = golden,
        **kwargs
    )
