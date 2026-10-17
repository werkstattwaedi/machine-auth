# Project Documentation

This directory contains structured documentation for the machine authentication system.

## Quick Start

- **🚀 [Configuration Guide](config.md)** - Complete setup for new environments
- **🔨 [Compilation Guide](compile.md)** - Building and running firmware
- **🔒 [Data Protection](data-protection.md)** - DSG operating manual: register, DSAR/erasure procedures, retention trim

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

### `spec/` - Product Spec

What the product does, as short checkable rules with permanent ids
(`MEM-3`), one file per domain. ADRs record *why*; the spec records *what*.
A branch first writes down the area as it is, then changes it in the same PR
as the behaviour; `/spec-check` and the Spec check workflow compare code
against it, and the `spec-expert` agent does the thinking. Conventions and glossary:
[spec/README.md](spec/README.md); see [ADR-0047](adr/0047-product-spec.md).

### `deploy/` - Deploy Steps

One file per migration a deploy needs around it — a data migration, a
backfill, a data gate, a newly required config parameter, a console switch
— written for the agent that carries it out; `scripts/deploy.sh` stops for
the ones added since the environment's last deploy. A fresh installation
follows `deployment-checklist.md` instead and has none pending; files stay,
because another installation may deploy from an older tag. Conventions:
[deploy/README.md](deploy/README.md); see
[ADR-0049](adr/0049-deploy-steps.md).

### `requirements/` - Product Requirements

Longer requirement documents for a feature before it exists. Rules about how
the product behaves today belong in `spec/`. Use for:
- Feature requirements
- User workflows
- Business rules
- Non-functional requirements (performance, security, etc.)

**Key documents:**
- [admin-ui-deployment.md](requirements/admin-ui-deployment.md) - Production deployment checklist

### `ideas/` - Exploration & Future Work

Brainstorming, research notes, and future work. Use for:
- Feature ideas not yet committed
- Technical exploration
- Research findings
- "Someday/maybe" backlog

### `plans/` - Implementation Plans

Detailed implementation plans for features in progress. These are working documents that may become stale after implementation. For permanent decisions, create an ADR instead.

### `ui-design/` - UI Assets

Design assets, mockups, and brand guidelines.

## File Naming

- **ADRs:** `NNNN-descriptive-title.md` (e.g., `0001-use-firebase-for-backend.md`)
- **Deploy steps:** `YYYY-MM-DD-slug.md` (the date written; never renamed — a rename counts as a new step)
- **Requirements:** Freeform, descriptive names
- **Ideas:** Freeform, descriptive names

## Workflow

1. **During sessions:** Create ADRs for significant decisions made during development
2. **After implementation:** Document the "why" if it's not obvious from code
3. **Before major changes:** Review existing ADRs to understand constraints
4. **GitHub issues** are for tracking work; **docs/** is for recording decisions and context

## Root-Level Documentation

- [`config.md`](config.md) - **Configuration guide for all system components**
- [`compile.md`](compile.md) - Firmware build instructions

## Related Files

- `../CLAUDE.md` - AI context and development patterns
- `../firestore/schema.jsonc` - Database schema
- `../scripts/README.md` - Scripts documentation
- GitHub Issues - Active work tracking
