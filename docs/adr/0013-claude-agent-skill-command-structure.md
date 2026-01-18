# ADR-0013: Claude Code Agent, Skill, and Command Structure

**Status:** Accepted

**Date:** 2026-01-18

## Context

We use Claude Code for development assistance and want to create domain-specific experts (e.g., Pigweed, LVGL, NFC protocols) that can be consulted for architecture decisions, code review, and implementation guidance.

Claude Code supports three mechanisms for extending its capabilities:
1. **Agents** - Subagents invoked via the Task tool for autonomous work
2. **Skills** - Ambient context auto-activated based on code patterns
3. **Commands** - Slash commands (`/command-name`) manually invoked by users

We need a consistent structure for organizing these components, their knowledge bases, and task-specific prompts.

## Decision

### Directory Structure

```
.claude/
├── commands/                           # Slash commands (user-invoked)
│   ├── <prefix>-plan.md               # Interactive planning (main context)
│   ├── <prefix>-review.md             # Code review (triggers subagent)
│   ├── <prefix>-explain.md            # Module explanation (triggers subagent)
│   └── <prefix>-update-docs.md        # Update knowledge (triggers subagent)
│
├── skills/
│   └── <domain>/
│       └── SKILL.md                   # Ambient triggers + quick reference
│
└── agents/
    ├── <domain>-expert.md             # Agent definition + task type index
    └── <domain>-expert/
        ├── <knowledge-files>          # Domain knowledge (MODULES.md, SUMMARY.md, etc.)
        └── tasks/
            ├── review.md              # Detailed review task prompt
            ├── explain.md             # Detailed explain task prompt
            └── update-docs.md         # Detailed update task prompt
```

### Component Responsibilities

#### Commands (`.claude/commands/*.md`)
- **Location:** Must be in `.claude/commands/` (not nested in skills)
- **Purpose:** User-invoked slash commands
- **Format:** Markdown with YAML frontmatter (`description`, `allowed-tools`)
- **Types:**
  - **Interactive commands** (e.g., `plan`): Full prompt in command file, runs in main context for back-and-forth iteration
  - **Subagent triggers** (e.g., `review`, `explain`): Thin file that invokes the agent with a task type

#### Skills (`.claude/skills/<domain>/SKILL.md`)
- **Purpose:** Ambient context automatically activated by code patterns
- **Content:**
  - Activation triggers (what patterns to look for)
  - Quick reference tables (common anti-patterns, solutions)
  - Brief code examples
  - Pointer to agent for deep analysis
- **Keep lightweight:** Skills are loaded into context, so avoid large content

#### Agents (`.claude/agents/<domain>-expert.md`)
- **Purpose:** Subagent for autonomous tasks requiring deep analysis
- **Content:**
  - Agent description and tools
  - Knowledge base locations
  - Task type index (links to task files)
  - General guidance
- **Knowledge:** Stored in `.claude/agents/<domain>-expert/` subdirectory
- **Tasks:** Detailed prompts in `.claude/agents/<domain>-expert/tasks/`

### Task Type Selection

| Task | Execution | Reason |
|------|-----------|--------|
| `plan` | Main context | Interactive, needs user iteration |
| `review` | Subagent | Autonomous analysis, returns report |
| `explain` | Subagent | Research task, returns explanation |
| `update-docs` | Subagent | File operations, returns summary |

### Command File Formats

**Interactive command (runs in main context):**
```markdown
---
description: Brief description for /help
---

# Full Prompt Title

Detailed instructions for Claude to follow...

## Knowledge Base
- Path to knowledge files

## Instructions
1. Step 1
2. Step 2

## Output Format
...

$ARGUMENTS
```

**Subagent trigger (invokes agent):**
```markdown
---
description: Brief description for /help
---

# /command-name

Invoke the `<domain>-expert` agent to perform <task>.

**Task type:** <task-name>

**Task instructions:** `.claude/agents/<domain>-expert/tasks/<task>.md`

**Arguments:** $ARGUMENTS
```

### Knowledge Organization

Knowledge files live with the agent, not the skill:
- **Module catalogs:** `MODULES.md` - List of available modules/components
- **Patterns/examples:** `SUMMARY.md` - Common patterns, anti-patterns, code examples
- **Documentation index:** Map topics to local documentation files
- **Preprocessed docs:** `knowledge/overview.md` for PDF-based knowledge

For PDF-based knowledge:
- Store page images in `agents/<domain>-expert/pages/` (gitignored)
- Provide `init-pdf-pages.sh` script to regenerate from source PDFs
- Reference images from `overview.md`

### Naming Conventions

- **Agents:** `<domain>-expert` (e.g., `pigweed-expert`, `lvgl-expert`)
- **Skills:** `<domain>` directory with `SKILL.md`
- **Commands:** `<prefix>-<action>` (e.g., `pw-review`, `lvgl-explain`)
- **Tasks:** `<action>.md` (e.g., `review.md`, `explain.md`)

## Consequences

**Pros:**
- Clear separation of concerns (commands vs skills vs agents)
- Knowledge stays with agents (loaded on-demand, not ambient)
- Interactive tasks run in main context for iteration
- Autonomous tasks run as subagents for efficiency
- Consistent structure makes adding new experts straightforward
- Local documentation preferred over web fetching

**Cons:**
- Multiple files per expert (commands + skill + agent + tasks + knowledge)
- Need to understand which component does what

**Tradeoffs:**

*Alternative: Everything in skills*
- Rejected: Skills are ambient (always loaded), so heavy knowledge would bloat context

*Alternative: Commands inside skills directory*
- Rejected: Claude Code only discovers commands in `.claude/commands/`

*Alternative: All tasks in main context*
- Rejected: Autonomous tasks (review, explain) don't need interaction and benefit from subagent isolation

## Example: Creating a New Expert

1. **Create the agent:**
   ```
   .claude/agents/foo-expert.md           # Agent definition
   .claude/agents/foo-expert/SUMMARY.md   # Knowledge
   .claude/agents/foo-expert/tasks/review.md
   .claude/agents/foo-expert/tasks/explain.md
   ```

2. **Create the skill:**
   ```
   .claude/skills/foo/SKILL.md            # Activation triggers
   ```

3. **Create the commands:**
   ```
   .claude/commands/foo-plan.md           # Interactive (full prompt)
   .claude/commands/foo-review.md         # Subagent trigger
   .claude/commands/foo-explain.md        # Subagent trigger
   ```

4. **Reference implementation:** See `pigweed-expert` for a complete example.
