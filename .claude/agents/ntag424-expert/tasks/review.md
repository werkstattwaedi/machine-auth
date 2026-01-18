# Review Task

Conduct a thorough code review focused on NTAG 424 DNA security implementation and protocol correctness.

## Process

### 1. Understand the Code

- Read the specified files
- Understand the authentication and encryption flows
- Note SUN/SDM implementation if present
- Identify APDU construction patterns

### 2. Check Against Documentation

- Reference NTAG 424 datasheet: `docs/proprietary/NTAG_424.pdf`
- Reference AN12196 for SUN/SDM: `docs/proprietary/AN12196_NTAG 424 DNA and NTAG 424 DNA TagTamper features and hints.pdf`
- Check knowledge base: `.claude/agents/ntag424-expert/knowledge/overview.md`
- For specific details, read page images from `.claude/agents/ntag424-expert/pages/`

### 3. Identify Issues

#### Critical Security Issues (Must Fix)

**Key management:**
- Hardcoded AES keys in source code
- Default keys (all zeros) in production
- Same key used for multiple tags
- Keys logged or exposed

**Authentication issues:**
- Missing CMAC verification on responses
- Incorrect session key derivation
- IV reuse or improper IV handling
- Wrong CMAC scope calculation

**SUN/SDM issues:**
- SDMReadCtr not validated server-side
- Replay attack vulnerability
- UID exposed without encryption
- CMAC calculation errors

#### Protocol Issues

**APDU construction:**
- Wrong CLA/INS/P1/P2 values
- Incorrect Lc/Le handling
- Missing ISO-DEP chaining for large data
- Wrong padding for AES operations

**Response handling:**
- Missing status word checking
- Ignoring error responses
- Incorrect response parsing

### 4. Prepare Recommendations

For each issue found:
1. Explain the security/correctness impact
2. Cite relevant documentation page
3. Show the correct implementation

## Output Format

### Summary
Brief overview: X security issues, Y protocol issues, Z recommendations

### Security Issues (Critical)
For each issue:
```
**Issue**: [Description]
**Location**: [File:line or function name]
**Risk**: [Security impact]
**Documentation**: [Datasheet/AN12196 page]
**Solution**: [How to fix]

Before:
```c
// vulnerable code
```

After:
```c
// secure code
```
```

### Protocol Issues
Issues affecting correctness but not directly security.

### Recommendations
Should-fix items for better implementation.

### What's Good
Acknowledge correct security patterns and good practices.

### Security Checklist
- [ ] Keys not hardcoded
- [ ] Session keys properly derived
- [ ] CMAC verified on all responses
- [ ] SDMReadCtr tracked and validated
- [ ] No sensitive data in logs
