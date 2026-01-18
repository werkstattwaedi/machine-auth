# Explain Task

Provide an in-depth explanation of a Pigweed module with practical examples and integration guidance.

## Process

### 1. Fetch Module Documentation

1. Read `.claude/agents/pigweed-expert/MODULES.md` for the module overview
2. Read detailed documentation at `third_party/pigweed/pw_<module>/docs.rst`
3. Check for examples in `third_party/pigweed/pw_<module>/examples/`

### 2. Analyze Module

Understand deeply:
- What problem does this module solve?
- What are the key types and functions?
- How does it integrate with other Pigweed modules?
- What are the design decisions and tradeoffs?
- What are common usage patterns?
- What mistakes do people commonly make?

## Output Format

### Overview
What this module does and when to use it (2-3 paragraphs)

### Key Concepts
Core types and their purposes

### Basic Usage
Simple example showing the most common use case

```cpp
// Example code
```

### Advanced Patterns
More sophisticated usage examples

### Integration
How this module works with other Pigweed modules

### Common Mistakes
What to avoid and why

### Comparison
How this compares to non-Pigweed alternatives (std::, manual implementations)

### Build Integration
How to add this to your BUILD.bazel:

```python
cc_library(
    name = "my_lib",
    deps = [
        "@pigweed//pw_<module>",
    ],
)
```
