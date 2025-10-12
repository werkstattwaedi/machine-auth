# Project Documentation

This directory contains structured documentation for the machine authentication system.

## Directory Structure

### `adr/` - Architecture Decision Records

Captures important architectural and design decisions. Use ADRs for:
- Technology choices (e.g., why Firebase instead of custom backend)
- Architectural patterns (e.g., client-side vs server-side auth)
- Data modeling decisions (e.g., DocumentReferences vs string paths)
- Security approaches (e.g., where to validate permissions)

**When to create an ADR:**
- The decision affects multiple parts of the system
- Future contributors will wonder "why did they do it this way?"
- There were significant tradeoffs or alternatives considered
- The decision is hard to reverse

**When NOT to create an ADR:**
- Implementation details already documented in code
- Obvious or standard practices
- Temporary workarounds (use code comments + issues instead)

### `requirements/` - Product Requirements

High-level product requirements, user stories, and functional specs. Use for:
- Feature requirements
- User workflows
- Business rules
- Non-functional requirements (performance, security, etc.)

### `ideas/` - Exploration & Future Work

Brainstorming, research notes, and future work. Use for:
- Feature ideas not yet committed
- Technical exploration
- Research findings
- "Someday/maybe" backlog

### `ui-design/` - UI Assets

Design assets, mockups, and brand guidelines.

## File Naming

- **ADRs:** `NNNN-descriptive-title.md` (e.g., `0001-use-firebase-for-backend.md`)
- **Requirements:** Freeform, descriptive names
- **Ideas:** Freeform, descriptive names

## Workflow

1. **During sessions:** Create ADRs for significant decisions made during development
2. **After implementation:** Document the "why" if it's not obvious from code
3. **Before major changes:** Review existing ADRs to understand constraints
4. **GitHub issues** are for tracking work; **docs/** is for recording decisions and context

## Related

- `CLAUDE.md` - AI context and development patterns
- `firestore/schema.jsonc` - Database schema
- GitHub Issues - Active work tracking
