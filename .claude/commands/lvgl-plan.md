---
description: Plan a UI implementation using idiomatic LVGL patterns. Use before implementing new UI features to ensure proper widget selection and architecture.
---

# LVGL UI Architecture Planning

You are helping plan a UI implementation using LVGL idiomatically. This requires deep analysis to recommend the right widgets and patterns.

## Knowledge Base

- **Agent reference**: `.claude/agents/lvgl-expert.md`
- **Widget docs**: `third_party/lvgl/docs/widgets/`
- **API reference**: `third_party/lvgl/src/widgets/`
- **Examples**: `third_party/lvgl/examples/`

## Instructions

### Phase 1: Understand Requirements

First, analyze what the user is trying to build:
- What is the UI functionality?
- What user interactions are needed (touch, encoder, keyboard)?
- What data needs to be displayed?
- What are the constraints (screen size, memory, refresh rate)?
- What visual style/theme is expected?

If requirements are unclear, ask clarifying questions.

### Phase 2: Check Documentation

1. Read `third_party/lvgl/docs/widgets/` to identify candidate widgets
2. For specific widget details, read header files in `third_party/lvgl/src/widgets/`
3. Check examples in `third_party/lvgl/examples/`

### Phase 3: Widget Selection

For each UI element, determine:
- Which LVGL widget(s) apply?
- What are the alternatives and tradeoffs?
- Are there widget combinations that work well together?

Consider these widget categories:
- **Display**: lv_label, lv_img, lv_led, lv_canvas
- **Input**: lv_btn, lv_textarea, lv_keyboard, lv_dropdown, lv_slider, lv_switch
- **Container**: lv_obj, lv_tabview, lv_tileview, lv_win
- **Data**: lv_chart, lv_table, lv_meter, lv_bar, lv_arc
- **Layout**: Flex, Grid

### Phase 4: Architecture Design

Design the UI following LVGL principles:
- **Object hierarchy**: What parent-child relationships?
- **Screen organization**: Multiple screens or single screen with visibility?
- **Style system**: What shared styles are needed?
- **Event handling**: What callbacks and how to organize them?
- **Memory management**: Static vs dynamic allocation?

### Phase 5: Implementation Strategy

Create a concrete plan:
- What order should things be built?
- What are the risk areas?
- What styles should be defined first?
- What can be reused?

## Output Format

### Summary
Brief overview of the recommended approach

### Recommended Widgets
| Widget | Purpose in This UI |
|--------|-------------------|
| lv_xxx | Why it's needed |

### Architecture
- Screen hierarchy diagram
- Key object relationships
- Style organization

### Styles
```c
// Shared styles needed
static lv_style_t style_xxx;
lv_style_init(&style_xxx);
lv_style_set_...
```

### Layout Strategy
- Flex vs Grid vs manual positioning
- Responsive considerations

### Implementation Phases
1. Phase 1: ...
2. Phase 2: ...

### Event Handling
- What events to handle
- Event handler organization

### Open Questions
- Things to resolve before/during implementation

---

## UI Feature to Plan

$ARGUMENTS
