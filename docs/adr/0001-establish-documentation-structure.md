# ADR-0001: Establish Documentation Structure

**Status:** Accepted

**Date:** 2025-10-12

## Context

The project has grown to include firmware (C++), cloud functions (TypeScript), and admin UI (Angular). Important decisions are scattered across:
- Code comments
- Commit messages
- GitHub issues
- CLAUDE.md (AI context)

This makes it hard to:
- Understand why certain architectural choices were made
- Onboard new contributors
- Revisit decisions when requirements change

We need a lightweight system to capture architectural decisions and requirements without creating documentation overhead.

## Decision

Create a `docs/` directory with three subdirectories:
- `docs/adr/` - Architecture Decision Records (numbered, immutable)
- `docs/requirements/` - Product requirements and specs
- `docs/ideas/` - Exploration, brainstorming, future work

Use a simple ADR template with: Status, Context, Decision, Consequences.

Keep `CLAUDE.md` focused on AI-specific development context (patterns, commands, gotchas). Point to `docs/` for architectural decisions.

## Consequences

**Pros:**
- Clear place to document "why" for future reference
- ADRs are immutable records (supersede instead of edit)
- Lightweight - no heavy process required
- Separates concerns: CLAUDE.md = dev context, docs/adr/ = decisions

**Cons:**
- Requires discipline to actually create ADRs when making decisions
- Small overhead in session time to document

**Tradeoffs:**
- Considered keeping everything in CLAUDE.md, but it's too AI-specific and would become unwieldy
- Considered full RFC process, but too heavyweight for a small project
- Chose ADRs as a good middle ground - structured but minimal
