# Update Docs Task

Update the LVGL knowledge from local documentation.

## Local Documentation Sources

All documentation comes from the local LVGL checkout:

- **Main docs**: `third_party/lvgl/docs/`
- **Widget docs**: `third_party/lvgl/docs/widgets/`
- **API in source**: `third_party/lvgl/src/`
- **Widget headers**: `third_party/lvgl/src/widgets/`
- **Examples**: `third_party/lvgl/examples/`

## Process

### 1. Inventory Local Widgets

List all widgets in the local checkout:
```
ls third_party/lvgl/src/widgets/
```

### 2. Read Widget Documentation

For each widget category, read:
- `third_party/lvgl/docs/widgets/<category>.rst`
- Widget header files for API details

### 3. Check for New Features

Look for:
- New widgets added
- Deprecated widgets
- API changes

### 4. Update Knowledge

Note any significant findings:
- New widgets to recommend
- Changed APIs
- New patterns or best practices

## Output Format

Report:
- Local LVGL path: `third_party/lvgl/`
- Number of widgets found
- Any new widgets or features
- Any deprecated items
- Recommendations for knowledge updates
