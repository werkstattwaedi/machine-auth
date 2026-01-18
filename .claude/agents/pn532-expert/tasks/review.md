# Review Task

Conduct a thorough code review focused on PN532 driver implementation and NFC protocol correctness.

## Process

### 1. Understand the Code

- Read the specified files
- Understand the communication interface being used (HSU, I2C, SPI)
- Note the NFC protocols being implemented
- Identify command/response patterns

### 2. Check Against Documentation

- Reference PN532 datasheet: `docs/proprietary/Pn532um.pdf`
- Check knowledge base: `.claude/agents/pn532-expert/knowledge/overview.md`
- For specific details, read page images from `.claude/agents/pn532-expert/pages/`

### 3. Identify Issues

#### Critical Issues (Must Fix)

**Frame format errors:**
- Incorrect preamble/postamble bytes
- Wrong checksum calculation (LCS, DCS)
- Missing ACK handling
- Improper extended frame handling for large data

**Protocol errors:**
- Missing SAMConfiguration after reset
- Wrong command codes
- Incorrect parameter encoding
- Missing error handling in responses

**Communication issues:**
- No ACK check after sending command
- Fixed delays instead of ready signaling
- Missing timeout handling
- Interface-specific issues (I2C clock stretching, SPI status polling)

#### Reliability Issues

- No retry logic for communication errors
- Missing NACK handling
- Ignoring error bytes in responses
- No timeout on card operations

#### Performance Issues

- Inefficient polling (fixed delays vs interrupt/ready)
- RF field management (always on vs as-needed)
- Suboptimal baud rate configuration

### 4. Prepare Recommendations

For each issue found:
1. Explain what's wrong and cite datasheet page
2. Show the correct approach with code example
3. Explain the consequence of not fixing

## Output Format

### Summary
Brief overview of findings (X critical, Y recommendations, Z nice-to-haves)

### Critical Issues
For each issue:
```
**Issue**: [Description]
**Location**: [File:line or function name]
**Problem**: [Why this is problematic]
**Datasheet Reference**: Page XX
**Solution**: [How to fix]

Before:
```c
// problematic code
```

After:
```c
// corrected code
```
```

### Recommendations
Should-fix items for better reliability and performance.

### Nice-to-Haves
Optional improvements for consideration.

### What's Good
Acknowledge correct patterns and good practices.
