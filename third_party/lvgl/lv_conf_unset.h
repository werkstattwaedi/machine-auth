// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// This file produces a compile error when lv_conf is not configured.
// Set the label flag to your project's lv_conf.h:
//   --//third_party/lvgl:lv_conf=//maco_firmware/modules/display:lv_conf

#error "LVGL lv_conf not configured. Set --//third_party/lvgl:lv_conf=//your:lv_conf_target in .bazelrc or platform flags"
