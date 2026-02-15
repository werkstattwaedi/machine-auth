# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Bazel rules for generating LVGL fonts from TTF files using lv_font_conv.

Uses aspect_rules_js for hermetic npm package management.

Example usage:
    load("//third_party/lvgl:font.bzl", "lvgl_font")

    lvgl_font(
        name = "roboto_24",
        ttf = "Roboto-Regular.ttf",
        size = 24,
    )
"""

def lvgl_font(
        name,
        ttf,
        size,
        bpp = 4,
        range = "32-255",
        no_compress = True,
        visibility = None):
    """Generate LVGL font from TTF file.

    Args:
        name: Font name (creates symbol with this name, e.g., "roboto_24")
        ttf: Source TTF font file
        size: Font size in pixels
        bpp: Bits per pixel (1, 2, 4, or 8; default: 4)
        range: Unicode range (default: "32-255" for Latin-1)
        no_compress: Disable compression (default: True)
        visibility: Bazel visibility
    """

    output_c = name + ".c"
    compress_flag = "--no-compress" if no_compress else ""

    # Use genrule to run lv_font_conv via node from the linked npm package
    # The :dir target points to the package directory
    cmd = """
PKG_DIR=$(location //third_party/lvgl:node_modules/lv_font_conv/dir)
node $$PKG_DIR/lv_font_conv.js \\
    --bpp {bpp} \\
    --size {size} \\
    {compress_flag} \\
    --font $(location {ttf}) \\
    --range {range} \\
    --format lvgl \\
    --lv-include lvgl.h \\
    -o $@
""".format(
        bpp = bpp,
        size = size,
        compress_flag = compress_flag,
        ttf = ttf,
        range = range,
    )

    native.genrule(
        name = name + "_gen",
        srcs = [
            ttf,
            "//third_party/lvgl:node_modules/lv_font_conv/dir",
        ],
        outs = [output_c],
        cmd = cmd,
    )

    native.cc_library(
        name = name,
        srcs = [output_c],
        deps = ["//third_party/lvgl"],
        alwayslink = True,
        visibility = visibility,
    )
