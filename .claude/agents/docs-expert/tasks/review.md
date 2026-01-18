# Review Task

Review code for consistency with documented architecture decisions and requirements.

## Process

### 1. Read Documentation

First, gather context:
- Read all ADRs in `docs/adr/`
- Read relevant requirements in `docs/requirements/`
- Note any design documents in `docs/design/`

### 2. Review the Code

For the specified code:
- Understand what it's implementing
- Note any architectural patterns used
- Identify technology/library choices
- Note data models and interfaces

### 3. Check Consistency

Compare code against documentation:

**ADR Compliance:**
- Does the code follow accepted ADRs?
- Are there deviations that need justification?
- Are there decisions in code not captured in ADRs?

**Requirements Alignment:**
- Does implementation match requirements?
- Are there undocumented features?
- Are there requirements not yet implemented?

**Pattern Consistency:**
- Does code follow established patterns?
- Are similar problems solved the same way?

### 4. Identify Documentation Gaps

Look for:
- Significant decisions not captured in ADRs
- New patterns that should be documented
- Outdated documentation references

## Output Format

### Summary
Brief overview: X compliance issues, Y documentation gaps, Z recommendations

### ADR Compliance

For each issue:
```
**ADR**: NNNN-title.md
**Code**: [file:line or function]
**Issue**: [What doesn't match]
**Recommendation**: [Fix code or supersede ADR]
```

### Documentation Gaps

Significant decisions not currently documented:
```
**Decision**: [What was decided]
**Location**: [Where in code]
**Recommendation**: Draft ADR for [topic]
```

### Outdated Documentation

Documentation that needs updates:
```
**Document**: [Path]
**Issue**: [What's outdated]
**Action**: [Update or deprecate]
```

### What's Aligned
Code that correctly follows documentation.

### Suggested ADRs
If significant undocumented decisions found, suggest ADR topics.
