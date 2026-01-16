# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""
Bazel rules for generating LVGL lv_conf.h configuration files.

This module provides:
- LV_CONF_DEFAULTS: Default values for all configurable options
- LV_CONF_HOST: Preset for host/simulator builds
- LV_CONF_P2: Preset for P2 hardware builds
- LV_CONF_P2_DEBUG: Preset for P2 hardware with logging enabled
- lv_conf_library(): Rule to generate lv_conf.h and create a cc_library

Example usage:

    load("//maco_firmware/lvgl_config:lv_conf.bzl",
         "lv_conf_library", "LV_CONF_P2")

    # Use a preset directly
    lv_conf_library(
        name = "lvgl_conf",
        base = LV_CONF_P2,
    )

    # Override specific options from a preset
    lv_conf_library(
        name = "lvgl_conf_debug",
        base = LV_CONF_P2,
        options = {
            "LV_USE_LOG": 1,
            "LV_LOG_LEVEL": "LV_LOG_LEVEL_TRACE",
        },
    )

    # Build from scratch with only specific options
    lv_conf_library(
        name = "lvgl_conf_custom",
        options = {
            "LV_USE_LOG": 1,
            "LV_DRAW_SW_SUPPORT_RGB565": 1,
        },
    )
"""

load("@bazel_skylib//rules:expand_template.bzl", "expand_template")
load("@rules_cc//cc:cc_library.bzl", "cc_library")

# =============================================================================
# DEFAULT VALUES
# =============================================================================
# These are the default values for all configurable options.
# Values match the P2 hardware configuration as the baseline.

LV_CONF_DEFAULTS = {
    # Target description (appears in header comment)
    "TARGET_DESCRIPTION": "Default",

    # Color/Display settings
    "LV_COLOR_DEPTH": "16",
    "LV_DRAW_SW_SUPPORT_RGB565": "0",
    "LV_DRAW_SW_SUPPORT_RGB565_SWAPPED": "1",
    "LV_DRAW_SW_SUPPORT_RGB565A8": "0",
    "LV_DRAW_SW_SUPPORT_RGB888": "1",
    "LV_DRAW_SW_SUPPORT_XRGB8888": "0",
    "LV_DRAW_SW_SUPPORT_ARGB8888": "0",
    "LV_DRAW_SW_SUPPORT_ARGB8888_PREMULTIPLIED": "0",
    "LV_DRAW_SW_SUPPORT_L8": "0",
    "LV_DRAW_SW_SUPPORT_AL88": "0",
    "LV_DRAW_SW_SUPPORT_A8": "0",
    "LV_DRAW_SW_SUPPORT_I1": "0",

    # Memory settings
    "LV_MEM_SIZE": "(64 * 1024U)",
    "LV_DRAW_LAYER_SIMPLE_BUF_SIZE": "(24 * 1024)",
    "LV_DRAW_THREAD_STACK_SIZE": "(8 * 1024)",

    # Logging settings
    "LV_USE_LOG": "0",
    "LV_LOG_LEVEL": "LV_LOG_LEVEL_INFO",
    "LV_LOG_PRINTF": "0",
    "LV_LOG_USE_TIMESTAMP": "1",
    "LV_LOG_USE_FILE_LINE": "1",
    "LV_LOG_TRACE_MEM": "1",
    "LV_LOG_TRACE_TIMER": "1",
    "LV_LOG_TRACE_INDEV": "1",
    "LV_LOG_TRACE_DISP_REFR": "1",
    "LV_LOG_TRACE_EVENT": "1",
    "LV_LOG_TRACE_OBJ_CREATE": "1",
    "LV_LOG_TRACE_LAYOUT": "1",
    "LV_LOG_TRACE_ANIM": "1",
    "LV_LOG_TRACE_CACHE": "1",

    # Debug settings
    "LV_USE_REFR_DEBUG": "0",
    "LV_USE_LAYER_DEBUG": "0",
    "LV_USE_PARALLEL_DRAW_DEBUG": "0",

    # Assert settings
    "LV_USE_ASSERT_NULL": "1",
    "LV_USE_ASSERT_MALLOC": "1",
    "LV_USE_ASSERT_STYLE": "0",
    "LV_USE_ASSERT_MEM_INTEGRITY": "0",
    "LV_USE_ASSERT_OBJ": "0",

    # Driver settings
    "LV_USE_ST7735": "0",
    "LV_USE_ST7789": "0",
    "LV_USE_ST7796": "0",
    "LV_USE_ILI9341": "1",
    "LV_USE_SDL": "0",
}

# =============================================================================
# PRESET CONFIGURATIONS
# =============================================================================
# These presets can be used as the 'base' parameter in lv_conf_library().
# They inherit from LV_CONF_DEFAULTS and override specific values.

def _merge_options(base, overrides):
    """Merge override options into base options."""
    result = dict(base)
    result.update(overrides)
    return result

# Host/Simulator configuration
LV_CONF_HOST = _merge_options(LV_CONF_DEFAULTS, {
    "TARGET_DESCRIPTION": "Simulator",

    # Standard RGB565 (not swapped) for host displays
    "LV_DRAW_SW_SUPPORT_RGB565": "1",
    "LV_DRAW_SW_SUPPORT_RGB565_SWAPPED": "0",

    # Enable logging for development
    "LV_USE_LOG": "1",
    "LV_LOG_LEVEL": "LV_LOG_LEVEL_WARN",
    "LV_LOG_PRINTF": "1",

    # Use ST7789 for host testing, not ILI9341
    "LV_USE_ST7789": "1",
    "LV_USE_ILI9341": "0",
})

# P2 Hardware configuration (production)
LV_CONF_P2 = _merge_options(LV_CONF_DEFAULTS, {
    "TARGET_DESCRIPTION": "Hardware",

    # Swapped RGB565 for P2 hardware display
    "LV_DRAW_SW_SUPPORT_RGB565": "0",
    "LV_DRAW_SW_SUPPORT_RGB565_SWAPPED": "1",

    # Logging disabled for production
    "LV_USE_LOG": "0",
    "LV_LOG_LEVEL": "LV_LOG_LEVEL_INFO",
    "LV_LOG_PRINTF": "0",

    # ILI9341 driver for P2 hardware
    "LV_USE_ST7789": "0",
    "LV_USE_ILI9341": "1",
})

# P2 Hardware configuration with debugging enabled
LV_CONF_P2_DEBUG = _merge_options(LV_CONF_P2, {
    "TARGET_DESCRIPTION": "Hardware Debug",

    # Enable logging for debugging
    "LV_USE_LOG": "1",
    "LV_LOG_LEVEL": "LV_LOG_LEVEL_INFO",
    "LV_LOG_PRINTF": "0",  # Still use callback, not printf

    # Enable debug visualizations
    "LV_USE_REFR_DEBUG": "1",
})

# =============================================================================
# RULE IMPLEMENTATION
# =============================================================================

def lv_conf_library(
        name,
        base = None,
        options = None,
        target_compatible_with = None,
        visibility = None):
    """
    Generates an lv_conf.h file and creates a cc_library target.

    Args:
        name: Name of the target. The generated header will be at <name>/lv_conf.h
        base: Optional base configuration dict to inherit from.
              Use one of: LV_CONF_DEFAULTS, LV_CONF_HOST, LV_CONF_P2, LV_CONF_P2_DEBUG
              or a custom dict. If not specified, LV_CONF_DEFAULTS is used.
        options: Optional dict of options to override from the base.
                 Keys should match the configurable options (e.g., "LV_USE_LOG": 1).
        target_compatible_with: Optional list of constraint values for cc_library.
        visibility: Optional visibility for the cc_library target.

    Example:
        lv_conf_library(
            name = "lvgl_conf",
            base = LV_CONF_P2,
            options = {"LV_USE_LOG": 1},
        )
    """

    # Start with defaults
    final_options = dict(LV_CONF_DEFAULTS)

    # Apply base configuration if provided
    if base:
        final_options.update(base)

    # Apply user overrides
    if options:
        # Convert integer values to strings
        string_options = {k: str(v) for k, v in options.items()}
        final_options.update(string_options)

    # Build substitutions dict with ${KEY} format for expand_template
    substitutions = {"${%s}" % k: v for k, v in final_options.items()}

    # Generate the header file
    gen_name = name + "_gen"
    expand_template(
        name = gen_name,
        template = "//maco_firmware/lvgl_config:lv_conf.h.template",
        out = name + "/lv_conf.h",
        substitutions = substitutions,
    )

    # Create cc_library that provides the header
    cc_library(
        name = name,
        hdrs = [":" + gen_name],
        includes = [name],
        target_compatible_with = target_compatible_with,
        visibility = visibility,
    )

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def get_lv_conf_options(base = None, **kwargs):
    """
    Returns a merged options dict that can be exported and reused.

    This is useful when you want to define a configuration in one place
    and reference it from multiple BUILD files.

    Args:
        base: Optional base configuration dict to start from.
        **kwargs: Option overrides to apply.

    Returns:
        A dict containing the merged configuration options.

    Example in a .bzl file:
        MY_CUSTOM_CONFIG = get_lv_conf_options(
            base = LV_CONF_P2,
            LV_USE_LOG = 1,
            LV_MEM_SIZE = "(128 * 1024U)",
        )

    Then in BUILD:
        load("//my/package:config.bzl", "MY_CUSTOM_CONFIG")
        lv_conf_library(
            name = "lvgl_conf",
            base = MY_CUSTOM_CONFIG,
        )
    """
    result = dict(LV_CONF_DEFAULTS)
    if base:
        result.update(base)

    # Convert all values to strings
    string_kwargs = {k: str(v) for k, v in kwargs.items()}
    result.update(string_kwargs)

    return result
