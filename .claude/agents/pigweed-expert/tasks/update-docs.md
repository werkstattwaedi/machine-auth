# Update Docs Task

Update the Pigweed knowledge base from local documentation.

## Current Knowledge Location

- **Module catalog**: `.claude/agents/pigweed-expert/MODULES.md`
- **Patterns & examples**: `.claude/agents/pigweed-expert/SUMMARY.md`

## Local Documentation Sources

All documentation comes from the local Pigweed checkout:

- **Module docs**: `third_party/pigweed/pw_*/docs.rst`
- **General docs**: `third_party/pigweed/docs/sphinx/`
- **Concepts**: `third_party/pigweed/docs/concepts/`
- **Style guide**: `third_party/pigweed/docs/style_guide.rst`
- **Embedded C++ guide**: `third_party/pigweed/docs/embedded_cpp_guide.rst`

## Process

### 1. Inventory Local Modules

List all modules in the local checkout:
```
ls third_party/pigweed/pw_*/
```

### 2. Compare with Current Knowledge

1. Read current `.claude/agents/pigweed-expert/MODULES.md`
2. Identify any new modules not in the catalog
3. Identify any modules that may have been removed/deprecated

### 3. Read Module Documentation

For each module, read:
- `third_party/pigweed/pw_<module>/docs.rst` - Main documentation
- `third_party/pigweed/pw_<module>/README.md` - If exists

### 4. Read General Documentation

Check for updated patterns and guidance:
- `third_party/pigweed/docs/sphinx/` - General documentation
- `third_party/pigweed/docs/concepts/` - Design concepts

### 5. Update Knowledge Files

Update MODULES.md with:
- Any new modules found
- Updated descriptions if module docs have changed

Update SUMMARY.md with:
- Any new patterns discovered
- Updated anti-pattern guidance
- New module integrations

## Output Format

Report:
- Local Pigweed path: `third_party/pigweed/`
- Number of `pw_*` modules found locally
- Any new modules (not in MODULES.md)
- Any deprecated/removed modules
- Changes made to knowledge files
