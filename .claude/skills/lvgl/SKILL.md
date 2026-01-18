# LVGL Idiomatic Code Skill

## Overview

This skill provides automatic guidance for idiomatic LVGL usage. It activates when working with LVGL-based embedded GUI projects to ensure best practices are followed.

## Activation Triggers

Activate this skill when you observe:

- Files including LVGL headers (e.g., `#include "lvgl.h"`, `#include "lvgl/lvgl.h"`)
- Code using `lv_` prefixed functions or types
- References to LVGL widgets in conversation
- Embedded GUI code that could benefit from LVGL patterns
- Code patterns that have well-known LVGL alternatives
- Display driver implementations

## When to Consult @lvgl-expert

Invoke the `lvgl-expert` agent for:
- Architecture decisions for complex UIs
- Multi-screen navigation design
- Performance optimization for large UIs
- Widget selection guidance

The agent has access to local LVGL docs at `third_party/lvgl/docs/`.

## Quick Reference: Anti-Patterns to Flag

When you see these patterns, suggest LVGL alternatives:

### High Priority (Always Flag)

| Pattern | Issue | LVGL Solution |
|---------|-------|--------------|
| Custom text rendering with draw calls | Reinventing the wheel | `lv_label_create()` |
| Manual rectangle drawing for buttons | No state handling | `lv_btn_create()` |
| Custom progress bar implementation | Missing features | `lv_bar_create()` |
| Manual x/y coordinate calculations | Not responsive | Flex/Grid layouts |
| Custom scrolling with offsets | Buggy, incomplete | `LV_OBJ_FLAG_SCROLLABLE` |
| Manual touch region detection | Error prone | LVGL event system |
| Custom animation tick counters | Not integrated | `lv_anim_t` APIs |
| Hardcoded color values everywhere | Hard to maintain | Style system |

### Medium Priority (Suggest)

| Pattern | Issue | LVGL Solution |
|---------|-------|--------------|
| Many similar style calls per widget | Repetitive | Shared `lv_style_t` |
| Manual positioning for lists | Tedious | `lv_list_create()` or flex |
| Custom dropdown implementation | Incomplete | `lv_dropdown_create()` |
| DIY gauge/meter drawing | Complex math | `lv_meter_create()` |
| Custom tab switching logic | State management | `lv_tabview_create()` |

## Widget Quick Reference

### Basic Widgets

**lv_label** - Text display
```c
lv_obj_t *label = lv_label_create(parent);
lv_label_set_text(label, "Hello");
lv_label_set_long_mode(label, LV_LABEL_LONG_WRAP);
```

**lv_btn** - Button with states
```c
lv_obj_t *btn = lv_btn_create(parent);
lv_obj_add_event_cb(btn, btn_cb, LV_EVENT_CLICKED, NULL);
lv_obj_t *label = lv_label_create(btn);
lv_label_set_text(label, "Click me");
```

**lv_bar** - Progress bar
```c
lv_obj_t *bar = lv_bar_create(parent);
lv_bar_set_value(bar, 70, LV_ANIM_ON);
```

**lv_slider** - Slider control
```c
lv_obj_t *slider = lv_slider_create(parent);
lv_slider_set_range(slider, 0, 100);
lv_obj_add_event_cb(slider, slider_cb, LV_EVENT_VALUE_CHANGED, NULL);
```

### Layouts

**Flex layout** - Arrange children in row/column
```c
lv_obj_set_flex_flow(container, LV_FLEX_FLOW_ROW);
lv_obj_set_flex_align(container, LV_FLEX_ALIGN_SPACE_EVENLY,
                      LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
```

**Grid layout** - 2D grid arrangement
```c
static lv_coord_t col_dsc[] = {100, 100, LV_GRID_TEMPLATE_LAST};
static lv_coord_t row_dsc[] = {50, 50, LV_GRID_TEMPLATE_LAST};
lv_obj_set_grid_dsc_array(container, col_dsc, row_dsc);
lv_obj_set_grid_cell(child, LV_GRID_ALIGN_CENTER, 0, 1,
                     LV_GRID_ALIGN_CENTER, 0, 1);
```

## Design Principles to Enforce

### 1. Use the Style System
```c
// Good: Shared style
static lv_style_t style_btn;
lv_style_init(&style_btn);
lv_style_set_bg_color(&style_btn, lv_palette_main(LV_PALETTE_BLUE));
lv_style_set_radius(&style_btn, 10);
lv_obj_add_style(btn1, &style_btn, 0);
lv_obj_add_style(btn2, &style_btn, 0);

// Bad: Inline styles repeated
lv_obj_set_style_bg_color(btn1, lv_color_hex(0x2196F3), 0);
lv_obj_set_style_radius(btn1, 10, 0);
lv_obj_set_style_bg_color(btn2, lv_color_hex(0x2196F3), 0);
lv_obj_set_style_radius(btn2, 10, 0);
```

### 2. Use Layouts Over Manual Positioning
```c
// Good: Flex layout
lv_obj_set_flex_flow(panel, LV_FLEX_FLOW_COLUMN);
lv_obj_set_flex_grow(child1, 1);
lv_obj_set_flex_grow(child2, 2);

// Bad: Manual positioning
lv_obj_set_pos(child1, 10, 10);
lv_obj_set_pos(child2, 10, 60);
```

### 3. Proper Event Handling
```c
// Good: Use event data
static void event_cb(lv_event_t *e) {
    lv_obj_t *target = lv_event_get_target(e);
    void *user_data = lv_event_get_user_data(e);
}

// Bad: Global variables
static lv_obj_t *g_btn;  // Avoid globals for UI references
```

### 4. Widget Hierarchy
```c
// Good: Logical hierarchy
lv_obj_t *card = lv_obj_create(screen);
lv_obj_t *header = lv_obj_create(card);
lv_obj_t *title = lv_label_create(header);
lv_obj_t *content = lv_obj_create(card);

// Bad: Flat structure
lv_obj_t *title = lv_label_create(screen);
lv_obj_t *content = lv_label_create(screen);
```

## Event Types Reference

Common events to handle:
- `LV_EVENT_CLICKED` - Button/object clicked
- `LV_EVENT_VALUE_CHANGED` - Slider/switch value changed
- `LV_EVENT_PRESSED` / `LV_EVENT_RELEASED` - Press states
- `LV_EVENT_FOCUSED` / `LV_EVENT_DEFOCUSED` - Focus changes
- `LV_EVENT_SCROLL` - Scrolling events
- `LV_EVENT_DELETE` - Object being deleted (cleanup)

## Style Parts Reference

Style parts for targeting widget areas:
- `LV_PART_MAIN` - Main/background area
- `LV_PART_INDICATOR` - Indicator (bar fill, slider position)
- `LV_PART_KNOB` - Knob (slider handle)
- `LV_PART_ITEMS` - Items in list/dropdown
- `LV_PART_CURSOR` - Cursor in textarea
- `LV_PART_SCROLLBAR` - Scrollbar

## Style States Reference

Style states for different widget states:
- `LV_STATE_DEFAULT` - Normal state
- `LV_STATE_PRESSED` - Being pressed
- `LV_STATE_FOCUSED` - Has focus
- `LV_STATE_CHECKED` - Checkbox/switch checked
- `LV_STATE_DISABLED` - Disabled state
