# Ideas & Future Work

A lightweight backlog for features and improvements that aren't yet committed work.

## Format

Each idea should have:
- **Title** - Brief description
- **Status** - `💡 Idea` | `🔬 Exploring` | `📋 Planned` | `✅ Done` | `❌ Rejected`
- **Context** - Why might we want this?
- **Notes** - Any relevant thoughts, research, or links

---

## Active Ideas

### Session Broadcasting (Firmware)
**Status:** 💡 Idea

**Context:** Currently, every terminal queries the cloud when a user badges in. To reduce Firebase operations, we could broadcast active sessions to all terminals via Particle Pub/Sub.

**Notes:**
- Related to Firebase 100K operations/month budget constraint
- Each terminal maintains local session cache
- When session created, broadcast to all terminals
- Reduces cloud queries for multi-machine workflows
- Need to handle cache invalidation when session ends

**Related:** See CLAUDE.md section on Firebase Operations Budget

---

### Session Debug Viewer (Admin UI)
**Status:** 📋 Planned

**Context:** Admin UI has placeholder for sessions viewer. Need to implement for debugging and user support.

**Features:**
- View all sessions (active and historical)
- Filter by user, machine, date range
- View session details (usage records, timestamps)
- Manually close/invalidate sessions

---

## Template

Copy this for new ideas:

```markdown
### [Idea Title]
**Status:** 💡 Idea

**Context:** Why might we want this?

**Notes:** Any thoughts, research, or links
```
