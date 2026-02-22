# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Bazel rules for converting PNG images to LVGL C arrays.

Uses LVGL's own LVGLImage.py converter script. Automatically selects
RGB565_SWAPPED for P2 (SPI display) and RGB565 for host (native).

Example usage:
    load("//third_party/lvgl:image.bzl", "lvgl_image")

    lvgl_image(
        name = "logo",
        src = "logo.png",
    )
"""

def lvgl_image(
        name,
        src,
        cf = None,
        background = None,
        visibility = None):
    """Convert a PNG image to an LVGL C array.

    Args:
        name: Image name (creates symbol with this name, e.g., "logo")
        src: Source PNG file
        cf: Color format override (e.g., "RGB565", "RGB888"). If None,
            auto-selects RGB565_SWAPPED for P2, RGB565 for host.
        background: Background color hex (e.g., "ffffff") for compositing
            alpha onto opaque formats.
        visibility: Bazel visibility
    """

    output_c = name + ".c"
    bg_flag = " --background {bg}".format(bg = background) if background else ""

    if cf:
        # Explicit color format - no platform select needed
        cmd = "$(location //third_party/lvgl:lvgl_image_converter) --ofmt C --cf {cf}{bg} --name {name} -o $(@D) $(location {src})".format(
            cf = cf,
            bg = bg_flag,
            name = name,
            src = src,
        )
    else:
        # Auto-select based on target platform
        cmd = select({
            "//maco_firmware/targets/p2:is_p2": "$(location //third_party/lvgl:lvgl_image_converter) --ofmt C --cf RGB565_SWAPPED{bg} --name {name} -o $(@D) $(location {src})".format(bg = bg_flag, name = name, src = src),
            "//conditions:default": "$(location //third_party/lvgl:lvgl_image_converter) --ofmt C --cf RGB565{bg} --name {name} -o $(@D) $(location {src})".format(bg = bg_flag, name = name, src = src),
        })

    native.genrule(
        name = name + "_gen",
        srcs = [src],
        outs = [output_c],
        tools = ["//third_party/lvgl:lvgl_image_converter"],
        cmd = cmd,
    )

    native.cc_library(
        name = name,
        srcs = [output_c],
        copts = ["-DLV_LVGL_H_INCLUDE_SIMPLE"],
        deps = ["//third_party/lvgl"],
        alwayslink = True,
        visibility = visibility,
    )
