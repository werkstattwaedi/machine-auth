---
description: Create a new Architecture Decision Record (ADR). Guides you through capturing context, decision, and consequences for significant architectural choices.
---

# Create Architecture Decision Record

You are helping create an ADR (Architecture Decision Record) for this project. ADRs capture significant architectural decisions with their context and consequences.

## Documentation Location

- **ADR directory**: `docs/adr/`
- **ADR template**: `docs/adr/template.md`
- **Existing ADRs**: `docs/adr/NNNN-*.md`

## Instructions

### Phase 1: Understand the Decision

First, understand what decision needs to be captured:
- What is the technical decision?
- What problem does it solve?
- What alternatives were considered?
- What are the tradeoffs?

If unclear, ask clarifying questions.

### Phase 2: Gather Context

Understand the context:
- What motivated this decision?
- What constraints exist?
- What are the requirements?
- What has been tried before?

### Phase 3: Check for Related ADRs

Read existing ADRs in `docs/adr/`:
- Are there related decisions?
- Does this supersede an existing ADR?
- Should this reference other ADRs?

### Phase 4: Draft the ADR

Create a well-structured ADR:
1. **Title**: Clear, specific description of the decision
2. **Status**: Typically starts as "Proposed" or "Accepted"
3. **Context**: The forces at play, why this decision is needed
4. **Decision**: What we decided to do
5. **Consequences**: What becomes easier/harder because of this

### Phase 5: Determine ADR Number

List existing ADRs to find next number:
```bash
ls docs/adr/*.md | grep -E '[0-9]{4}' | sort | tail -1
```

## Output Format

### ADR Content

```markdown
# NNNN: [Title]

## Status
[Proposed | Accepted]

## Context
[What is the issue that we're seeing that is motivating this decision or change?]

## Decision
[What is the change that we're proposing and/or doing?]

## Consequences
[What becomes easier or more difficult to do because of this change?]
```

### File Location

After drafting, save to: `docs/adr/NNNN-kebab-case-title.md`

### Best Practices

- Keep it short (1-2 pages max)
- Focus on the "why" not just the "what"
- Link to relevant code or other ADRs
- One decision per ADR

---

## Decision to Document

$ARGUMENTS
