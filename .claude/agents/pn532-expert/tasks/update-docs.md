# Update Docs Task

Refresh the PN532 knowledge base from the source documentation.

## Documentation Sources

All documentation comes from:

- **PN532 User Manual**: `docs/proprietary/Pn532um.pdf`
- **Application Note**: `docs/proprietary/AN10682_How to use PN533.pdf`
- **Page images**: `.claude/agents/pn532-expert/pages/`

## Process

### 1. Verify Page Images Exist

Check if page images are available:
```bash
ls .claude/agents/pn532-expert/pages/
```

If missing, instruct user to run:
```bash
.claude/agents/init-pdf-pages.sh pn532
```

### 2. Review Key Pages

Read and analyze:
- Command reference pages (commands table)
- Frame format specification
- Interface-specific requirements (HSU, I2C, SPI)
- Error codes and handling
- Timing specifications

### 3. Update Overview

Check if `.claude/agents/pn532-expert/knowledge/overview.md` needs updates:
- Are all commands documented?
- Are frame formats accurate?
- Are interface details current?

### 4. Note Findings

Document:
- Any corrections needed in knowledge base
- Commands or features not well documented
- Recommendations for better coverage

## Output Format

Report:
- Page images status: [Available/Missing]
- Key sections reviewed
- Updates made or recommended
- Gaps in current knowledge base
- Suggestions for improvement
