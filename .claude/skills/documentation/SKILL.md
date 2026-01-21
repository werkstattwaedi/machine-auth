# Documentation Guardian Skill

## Overview

This skill ensures documentation stays in sync with code by proactively identifying when ADRs should be written and checking code against existing decisions.

## Activation Triggers

Activate this skill when you observe:

- Significant architectural changes being planned or implemented
- New dependencies being added (libraries, frameworks, services)
- API design discussions or changes
- Data model modifications
- Pattern changes from established conventions
- Technology choices being made
- Code that seems to contradict existing patterns in the project

## Documentation Structure Reference

This project has documentation in multiple locations:

### Project Documentation (`docs/`)

```
docs/
├── adr/                    # Architecture Decision Records
│   ├── NNNN-title.md       # Individual decisions
│   └── template.md         # ADR template
├── requirements/           # Product requirements
├── design/                 # Technical designs
└── ideas/                  # Future work
```

ADR template is at `docs/adr/template.md`.

### AI Context Documentation

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project overview, build commands |
| `maco_firmware/CLAUDE.md` | Pigweed patterns, architecture |
| `third_party/particle/CLAUDE.md` | Particle backends |

### AI Infrastructure (`.claude/`)

```
.claude/
├── agents/                 # Expert agent definitions
├── skills/                 # Proactive skill definitions
└── commands/               # Slash command definitions
```

**When suggesting documentation updates, consider all locations.**

## Proactive ADR Detection

### High-Priority ADR Triggers (Always Suggest)

| Change Type | Why ADR-Worthy | Example |
|-------------|----------------|---------|
| New dependency | Locks in technology choice | Adding a new RPC framework |
| API contract change | Affects consumers | Changing authentication flow |
| Data model change | Migration implications | New database schema |
| Architecture pattern | Sets precedent | Choosing event sourcing |
| Build system change | Affects all developers | Migrating to Bazel |

### Medium-Priority ADR Triggers (Consider Suggesting)

| Change Type | Why Consider | Example |
|-------------|--------------|---------|
| New module/component | May establish patterns | Creating a new service |
| Error handling approach | Consistency matters | Introducing Result types |
| Testing strategy | Affects quality | Adding integration tests |
| Logging/monitoring | Operational impact | Structured logging format |

### When NOT to Suggest ADRs

- Bug fixes
- Small refactors
- Style/formatting changes
- Single-file changes with obvious rationale
- Changes already covered by existing ADRs

## Proactive Prompting

When you detect an ADR-worthy change, **proactively suggest**:

> "This change [introduces X / modifies Y / adds Z]. This seems like a significant architectural decision. Should I draft an ADR to capture the context and reasoning?
>
> Suggested: `docs/adr/NNNN-descriptive-title.md`"

If the user agrees, draft the ADR or suggest consulting `@docs-expert`.

## Consistency Checking

When working on code, automatically check:

### Before Implementation

1. Read relevant ADRs in `docs/adr/`
2. Check if the planned change aligns with existing decisions
3. If conflict detected, raise it:

> "Note: This approach differs from ADR 0005 which decided [X]. Should we:
> a) Adjust the implementation to follow the ADR
> b) Supersede the ADR with a new decision"

### During Implementation

1. Note patterns being used
2. Compare against documented patterns
3. Flag deviations

### After Implementation

1. Check if significant undocumented decisions were made
2. Suggest ADRs for anything that should be captured

## ADR Quick Reference

### Required Sections

```markdown
# NNNN: Title

## Status
Proposed | Accepted | Deprecated | Superseded by NNNN

## Context
Why are we making this decision?

## Decision
What did we decide?

## Consequences
What are the implications?
```

### Good ADR Characteristics

- **Concise**: 1-2 pages max
- **Contextual**: Explains the "why"
- **Specific**: Names files, modules, patterns
- **Linked**: References related ADRs
- **Dated**: Has creation date

### ADR Numbering

- Sequential four-digit numbers: 0001, 0002, ...
- Check `docs/adr/` for current highest number
- Never reuse numbers, even for deprecated ADRs

## Integration with Reviews

When reviewing code changes:

1. **Check for ADR coverage**: Does the change have relevant ADRs?
2. **Verify compliance**: Does code match ADR decisions?
3. **Identify gaps**: Should new ADRs be written?

Include in review output:

```
## Documentation Check
- [ ] Change aligns with ADR-000N
- [ ] No ADR needed (reason: small scope)
- [ ] Suggest new ADR for: [topic]
```

## Behavioral Guidelines

1. **Be helpful, not bureaucratic**: Only suggest ADRs when genuinely valuable
2. **Explain the value**: Say why an ADR would help, not just that one is needed
3. **Offer to draft**: Don't just suggest - offer to write the ADR
4. **Keep it lightweight**: ADRs should capture decisions efficiently
5. **Connect the dots**: Link to related ADRs and code when relevant
