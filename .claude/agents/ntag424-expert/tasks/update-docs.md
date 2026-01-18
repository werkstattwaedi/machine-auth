# Update Docs Task

Refresh the NTAG 424 DNA knowledge base from the source documentation.

## Documentation Sources

All documentation comes from:

- **Main datasheet**: `docs/proprietary/NTAG_424.pdf`
- **SUN/SDM application note**: `docs/proprietary/AN12196_NTAG 424 DNA and NTAG 424 DNA TagTamper features and hints.pdf`
- **Page images**:
  - Datasheet: `.claude/agents/ntag424-expert/pages/datasheet/`
  - AN12196: `.claude/agents/ntag424-expert/pages/an12196/`

## Process

### 1. Verify Page Images Exist

Check if page images are available:
```bash
ls .claude/agents/ntag424-expert/pages/datasheet/
ls .claude/agents/ntag424-expert/pages/an12196/
```

If missing, instruct user to run:
```bash
.claude/agents/init-pdf-pages.sh ntag424
```

### 2. Review Key Sections

From the datasheet:
- Command reference (all APDUs)
- Authentication flow details
- File access conditions
- Error codes

From AN12196:
- SUN/SDM configuration
- CMAC calculation examples
- Backend verification flow
- Security best practices

### 3. Update Overview

Check if `.claude/agents/ntag424-expert/knowledge/overview.md` needs updates:
- Are all commands documented?
- Is authentication flow accurate?
- Are SUN/SDM details current?
- Are security recommendations complete?

### 4. Note Findings

Document:
- Any corrections needed in knowledge base
- Commands or features not well documented
- Security considerations that need emphasis

## Output Format

Report:
- Page images status: [Available/Missing] for each document
- Key sections reviewed
- Updates made or recommended
- Gaps in current knowledge base
- Security-related updates needed
