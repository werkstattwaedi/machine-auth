# Review Task

Conduct a thorough code review focused on idiomatic LVGL usage.

## Process

### 1. Understand the Code

- Read the specified files
- Understand the UI being built
- Note any existing LVGL widget usage
- Identify the patterns being used

### 2. Check Against Patterns

- Reference LVGL documentation at `third_party/lvgl/docs/`
- Check widget sources at `third_party/lvgl/src/widgets/`

### 3. Identify Issues

#### Critical Issues (Must Fix)

**Manual implementations that have LVGL alternatives:**
- Custom text rendering → `lv_label_create()`
- Manual rectangle drawing for buttons → `lv_btn_create()`
- Custom progress bar → `lv_bar_create()`
- Manual coordinate calculations → Flex/Grid layouts
- Custom scrolling → `LV_OBJ_FLAG_SCROLLABLE`
- Manual touch detection → LVGL event system
- Custom animation loops → `lv_anim_t` API
- Hardcoded colors/sizes → Style system

**Incorrect LVGL usage:**
- Not using parent-child hierarchy properly
- Styles defined per-object instead of shared
- Global variables for UI state
- Manual positioning instead of layouts
- Missing event cleanup on object deletion

#### Style Issues

- Not using `lv_` prefix conventions
- Inconsistent style application
- Hardcoded magic numbers for sizes/colors

#### Architecture Issues

- Flat object hierarchy (all on root screen)
- Tight coupling between screens
- No separation of UI and logic

### 4. Prepare Recommendations

For each issue found:
1. Explain what's wrong and why
2. Show the specific LVGL alternative
3. Provide before/after code examples

## Output Format

### Summary
Brief overview of findings (X critical, Y recommendations, Z nice-to-haves)

### Critical Issues
For each issue:
```
**Issue**: [Description]
**Location**: [File:line or function name]
**Problem**: [Why this is problematic]
**Solution**: Use `lv_xxx` instead

Before:
```c
// problematic code
```

After:
```c
// improved code using LVGL
```
```

### Recommendations
Should-fix items for better idiomatic usage.

### Nice-to-Haves
Optional improvements for consideration.

### What's Good
Acknowledge correct LVGL usage and good patterns.
