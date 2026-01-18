# Audit Task

Comprehensive audit of project documentation health.

## Process

### 1. Inventory Documentation

List all documentation:
```bash
find docs/ -name "*.md" -type f
```

### 2. ADR Health Check

For each ADR in `docs/adr/`:
- Is it properly formatted?
- Is the status current?
- Are code references valid?
- Is it still relevant?

Check for:
- Proposed ADRs older than 30 days (need resolution)
- ADRs referencing deleted code
- Missing ADRs for significant decisions

### 3. Requirements Coverage

For `docs/requirements/`:
- Are requirements linked to implementation?
- Are there orphaned requirements?
- Are implemented features documented?

### 4. Documentation Completeness

Check for:
- README presence and currency
- Getting started documentation
- API documentation if applicable
- Contributing guidelines

### 5. Cross-Reference Validation

Verify:
- Links between documents work
- Code references are valid
- Related ADRs are properly linked

## Output Format

### Summary
- Total documents: X
- ADRs: Y (Z proposed, W accepted, V deprecated)
- Health score: Good/Fair/Poor

### ADR Status

| ADR | Status | Age | Code Links Valid | Action Needed |
|-----|--------|-----|------------------|---------------|
| ... | ... | ... | ... | ... |

### Issues Found

**Critical** (blocking or misleading):
- ...

**Moderate** (should fix):
- ...

**Minor** (nice to fix):
- ...

### Documentation Gaps

Missing documentation:
- ...

### Stale Documentation

Documents needing updates:
- ...

### Recommendations

Priority actions:
1. ...
2. ...
3. ...
