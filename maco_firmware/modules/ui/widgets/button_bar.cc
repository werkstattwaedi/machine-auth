// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/ui/widgets/button_bar.h"

// Private header needed to access lv_draw_mask_rect_dsc_t fields (area, radius)
#include "src/draw/lv_draw_mask_private.h"

#include "maco_firmware/modules/terminal_ui/theme.h"

namespace maco::ui {

namespace {

constexpr int kPillRadius = 8;
constexpr int kPillOverflow = 8;  // Extends below screen edge
constexpr int kPillPadH = 12;     // Horizontal padding inside pill
constexpr int kPillPadV = 6;      // Vertical padding inside pill
constexpr int kPillGap = 8;       // Gap between pills in flex layout

// Draw callback: renders two-color split background masked to pill shape.
// Called at DRAW_MAIN_BEGIN (before pill draws its own bg). The pill bg is
// kept transparent so this callback provides the entire background.
// Draws fill_color on the left and track_color on the right as sharp-edged
// rects, masked to the pill's rounded shape via an ARGB8888 layer.
void PillFillDrawCb(lv_event_t* e) {
  auto* data = static_cast<ButtonBar::FillData*>(lv_event_get_user_data(e));
  if (data->progress == 0) return;

  auto* pill = static_cast<lv_obj_t*>(lv_event_get_current_target(e));
  lv_layer_t* layer = lv_event_get_layer(e);

  lv_area_t coords;
  lv_obj_get_coords(pill, &coords);
  int32_t w = lv_area_get_width(&coords);
  int32_t h = lv_area_get_height(&coords);
  int32_t radius = lv_obj_get_style_radius(pill, LV_PART_MAIN);
  int32_t short_side = LV_MIN(w, h);
  if (radius > short_side / 2) radius = short_side / 2;

  int32_t fill_w = w * data->progress / 100;

  // Create ARGB8888 layer covering full pill area for masked drawing
  lv_layer_t* fill_layer =
      lv_draw_layer_create(layer, LV_COLOR_FORMAT_ARGB8888, &coords);

  // Draw fill portion (left, sharp right edge)
  lv_draw_fill_dsc_t fill_dsc;
  lv_draw_fill_dsc_init(&fill_dsc);
  fill_dsc.color = lv_color_hex(data->fill_color);
  fill_dsc.opa = LV_OPA_COVER;
  fill_dsc.radius = 0;
  lv_area_t fill_area = coords;
  fill_area.x2 = fill_area.x1 + fill_w - 1;
  lv_draw_fill(fill_layer, &fill_dsc, &fill_area);

  // Draw track portion (right, sharp left edge)
  lv_draw_fill_dsc_t track_dsc;
  lv_draw_fill_dsc_init(&track_dsc);
  track_dsc.color = lv_color_hex(data->track_color);
  track_dsc.opa = LV_OPA_COVER;
  track_dsc.radius = 0;
  lv_area_t track_area = coords;
  track_area.x1 = coords.x1 + fill_w;
  lv_draw_fill(fill_layer, &track_dsc, &track_area);

  // Mask to pill's rounded shape
  lv_draw_mask_rect_dsc_t mask_dsc;
  lv_draw_mask_rect_dsc_init(&mask_dsc);
  mask_dsc.area = coords;
  mask_dsc.radius = radius;
  lv_draw_mask_rect(fill_layer, &mask_dsc);

  // Composite back onto parent layer
  lv_draw_image_dsc_t layer_dsc;
  lv_draw_image_dsc_init(&layer_dsc);
  layer_dsc.src = fill_layer;
  lv_draw_layer(layer, &layer_dsc, &coords);
}

lv_obj_t* CreatePill(lv_obj_t* parent) {
  lv_obj_t* pill = lv_obj_create(parent);
  lv_obj_set_height(pill, LV_SIZE_CONTENT);
  lv_obj_set_style_radius(pill, kPillRadius, LV_PART_MAIN);
  lv_obj_set_style_border_width(pill, 1, LV_PART_MAIN);
  lv_obj_set_style_pad_left(pill, kPillPadH, LV_PART_MAIN);
  lv_obj_set_style_pad_right(pill, kPillPadH, LV_PART_MAIN);
  lv_obj_set_style_pad_top(pill, kPillPadV, LV_PART_MAIN);
  lv_obj_set_style_pad_bottom(pill, kPillPadV + kPillOverflow, LV_PART_MAIN);
  lv_obj_set_style_translate_y(pill, kPillOverflow, LV_PART_MAIN);
  lv_obj_clear_flag(pill, LV_OBJ_FLAG_SCROLLABLE);
  return pill;
}

bool IsVisible(const ButtonSpec& spec) {
  return !spec.label.empty() && spec.bg_color != 0;
}

}  // namespace

ButtonBar::ButtonBar(lv_obj_t* parent) {
  // Flex row container at bottom of parent
  container_ = lv_obj_create(parent);
  lv_obj_set_size(container_, LV_PCT(100), kHeight);
  lv_obj_align(container_, LV_ALIGN_BOTTOM_MID, 0, 0);

  // Style: transparent background, no border
  lv_obj_set_style_bg_opa(container_, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_set_style_border_width(container_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_left(container_, 8, LV_PART_MAIN);
  lv_obj_set_style_pad_right(container_, 8, LV_PART_MAIN);
  lv_obj_set_style_pad_top(container_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_bottom(container_, 0, LV_PART_MAIN);

  // Flex layout: pills aligned to bottom, spaced apart.
  // Overflow visible so pills extend below the container — the rounded bottom
  // corners are hidden off-screen, giving a flat bottom edge.
  lv_obj_set_layout(container_, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(container_, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(container_, LV_FLEX_ALIGN_SPACE_BETWEEN,
                        LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_START);
  lv_obj_set_style_pad_column(container_, kPillGap, LV_PART_MAIN);
  lv_obj_add_flag(container_, LV_OBJ_FLAG_OVERFLOW_VISIBLE);

  // OK pill (left)
  ok_pill_ = CreatePill(container_);
  lv_obj_add_event_cb(ok_pill_, PillFillDrawCb, LV_EVENT_DRAW_MAIN_BEGIN,
                       &ok_fill_data_);
  ok_label_ = lv_label_create(ok_pill_);
  lv_obj_center(ok_label_);

  // Cancel pill (right)
  cancel_pill_ = CreatePill(container_);
  lv_obj_add_event_cb(cancel_pill_, PillFillDrawCb, LV_EVENT_DRAW_MAIN_BEGIN,
                       &cancel_fill_data_);
  cancel_label_ = lv_label_create(cancel_pill_);
  lv_obj_center(cancel_label_);
}

ButtonBar::~ButtonBar() {
  if (container_) {
    lv_obj_delete(container_);
    container_ = nullptr;
  }
}

void ButtonBar::SetConfig(const ButtonConfig& config) { config_.Set(config); }

void ButtonBar::Update() {
  if (!config_.CheckAndClearDirty()) {
    return;
  }

  const auto& config = config_.Get();
  bool both_visible = IsVisible(config.ok) && IsVisible(config.cancel);

  // When both pills visible, grow equally to fill width.
  // When only one visible, use content width.
  lv_obj_set_width(ok_pill_, both_visible ? 0 : LV_SIZE_CONTENT);
  lv_obj_set_flex_grow(ok_pill_, both_visible ? 1 : 0);
  lv_obj_set_width(cancel_pill_, both_visible ? 0 : LV_SIZE_CONTENT);
  lv_obj_set_flex_grow(cancel_pill_, both_visible ? 1 : 0);

  UpdatePill(ok_pill_, ok_label_, ok_fill_data_, config.ok);
  UpdatePill(cancel_pill_, cancel_label_, cancel_fill_data_, config.cancel);
}

void ButtonBar::UpdatePill(lv_obj_t* pill, lv_obj_t* label,
                           FillData& fill_data, const ButtonSpec& spec) {
  using namespace terminal_ui::theme;

  if (!IsVisible(spec)) {
    lv_obj_add_flag(pill, LV_OBJ_FLAG_HIDDEN);
    return;
  }

  lv_obj_remove_flag(pill, LV_OBJ_FLAG_HIDDEN);

  // Border: always 1px darkened
  lv_obj_set_style_border_color(pill, lv_color_hex(DarkenColor(spec.bg_color)),
                                LV_PART_MAIN);

  // Set label text and color
  lv_label_set_text(label, spec.label.data());
  lv_obj_set_style_text_color(label, lv_color_hex(spec.text_color),
                              LV_PART_MAIN);

  if (spec.fill_progress > 0) {
    // Determine fill/track colors based on background lightness.
    constexpr uint8_t kFillContrast = 102;
    if (IsLightColor(spec.bg_color)) {
      fill_data.track_color = LightenColor(spec.bg_color, kFillContrast);
      fill_data.fill_color = spec.bg_color;
    } else {
      fill_data.track_color = spec.bg_color;
      fill_data.fill_color = DarkenColor(spec.bg_color, kFillContrast);
    }
    fill_data.progress = spec.fill_progress;

    // Pill bg transparent — draw callback renders the split background
    lv_obj_set_style_bg_opa(pill, LV_OPA_TRANSP, LV_PART_MAIN);
  } else {
    fill_data.progress = 0;
    lv_obj_set_style_bg_color(pill, lv_color_hex(spec.bg_color), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(pill, LV_OPA_COVER, LV_PART_MAIN);
  }
}

}  // namespace maco::ui
