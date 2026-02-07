# ARM GCC 10-2020-q4 toolchain for Particle P2 compatibility
# Based on Pigweed's arm_none_eabi_gcc.BUILD

load("@rules_cc//cc/toolchains:tool.bzl", "cc_tool")
load("@rules_cc//cc/toolchains:tool_map.bzl", "cc_tool_map")

package(default_visibility = ["//visibility:public"])

licenses(["notice"])

exports_files(glob(["bin/**"]))

cc_tool_map(
    name = "all_tools",
    tools = {
        "@rules_cc//cc/toolchains/actions:assembly_actions": ":asm",
        "@rules_cc//cc/toolchains/actions:c_compile_actions": ":arm-none-eabi-gcc",
        "@rules_cc//cc/toolchains/actions:cpp_compile_actions": ":arm-none-eabi-g++",
        "@rules_cc//cc/toolchains/actions:link_actions": ":arm-none-eabi-ld",
        "@rules_cc//cc/toolchains/actions:objcopy_embed_data": ":arm-none-eabi-objcopy",
        "@pigweed//pw_toolchain/action:objdump_disassemble": ":arm-none-eabi-objdump",
        "@rules_cc//cc/toolchains/actions:strip": ":arm-none-eabi-strip",
        "@rules_cc//cc/toolchains/actions:ar_actions": ":arm-none-eabi-ar",
    },
)

cc_tool(
    name = "arm-none-eabi-ar",
    src = "//:bin/arm-none-eabi-ar",
)

cc_tool(
    name = "arm-none-eabi-g++",
    src = "//:bin/arm-none-eabi-g++",
    data = glob([
        "**/*.spec",
        "**/*.specs",
        "arm-none-eabi/include/**",
        "lib/gcc/arm-none-eabi/*/include/**",
        "lib/gcc/arm-none-eabi/*/include-fixed/**",
        "libexec/**",
    ]),
)

alias(
    name = "asm",
    actual = ":arm-none-eabi-gcc",
)

cc_tool(
    name = "arm-none-eabi-gcc",
    src = "//:bin/arm-none-eabi-gcc",
    data = glob([
        "**/*.spec",
        "**/*.specs",
        "arm-none-eabi/include/**",
        "lib/gcc/arm-none-eabi/*/include/**",
        "lib/gcc/arm-none-eabi/*/include-fixed/**",
        "libexec/**",
    ]) + ["//:arm-none-eabi/bin/as"],
)

cc_tool(
    name = "arm-none-eabi-ld",
    src = "//:bin/arm-none-eabi-g++",
    data = glob([
        "**/*.a",
        "**/*.ld",
        "**/*.o",
        "**/*.spec",
        "**/*.specs",
        "**/*.so",
        "libexec/**",
    ]) + ["//:arm-none-eabi/bin/ld"],
)

cc_tool(
    name = "arm-none-eabi-gcov",
    src = "//:bin/arm-none-eabi-gcov",
)

cc_tool(
    name = "arm-none-eabi-objcopy",
    src = "//:bin/arm-none-eabi-objcopy",
)

cc_tool(
    name = "arm-none-eabi-objdump",
    src = "//:bin/arm-none-eabi-objdump",
)

cc_tool(
    name = "arm-none-eabi-strip",
    src = "//:bin/arm-none-eabi-strip",
)
