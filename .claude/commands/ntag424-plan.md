---
description: Plan an NTAG 424 DNA implementation. Use before implementing authentication, SUN/SDM, or secure tag operations.
---

# NTAG 424 DNA Implementation Planning

You are helping plan an NTAG 424 DNA implementation. This requires deep understanding of security features, authentication protocols, and SUN/SDM.

## Knowledge Base

- **Agent reference**: `.claude/agents/ntag424-expert.md`
- **Pre-processed knowledge**: `.claude/agents/ntag424-expert/knowledge/overview.md`
- **Page images**:
  - Datasheet: `.claude/agents/ntag424-expert/pages/datasheet/`
  - AN12196: `.claude/agents/ntag424-expert/pages/an12196/`

## Instructions

### Phase 1: Understand Requirements

First, analyze what the user is trying to build:
- What is the use case (product authentication, access control, loyalty)?
- Is backend verification needed (SUN/SDM)?
- What security level is required?
- What files need to be read/written?
- Will keys need to be changed during personalization?

If requirements are unclear, ask clarifying questions.

### Phase 2: Check Documentation

1. Read `.claude/agents/ntag424-expert/knowledge/overview.md` for command reference
2. For SUN/SDM details, check AN12196 pages
3. For authentication flow, check datasheet
4. Always cite page numbers

### Phase 3: Security Architecture

Design the security model:
- Which keys for what purposes?
- What file access conditions?
- What key diversification strategy?
- How to handle key management?

Consider:
| Key | Typical Purpose |
|-----|-----------------|
| Key 0 | Master key - change other keys |
| Key 1 | NDEF file read (often for SDM) |
| Key 2 | NDEF file write |
| Key 3 | Proprietary file access |
| Key 4 | Additional purposes |

### Phase 4: SUN/SDM Design (if applicable)

For backend verification:
- What NDEF URL format?
- What data to mirror (UID, counter, CMAC)?
- Encryption vs plaintext for UID?
- Backend verification logic

### Phase 5: Implementation Strategy

Create a concrete plan:
- Personalization sequence
- Runtime operation flow
- Key management approach
- Backend integration (if SUN/SDM)

## Output Format

### Summary
Brief overview of the recommended approach

### Security Model
| Key | Purpose | Diversification |
|-----|---------|----------------|
| Key 0 | ... | ... |

### File Configuration
| File | Access Read | Access Write | Contents |
|------|-------------|--------------|----------|
| 01 (CC) | ... | ... | ... |
| 02 (NDEF) | ... | ... | ... |
| 03 (Proprietary) | ... | ... | ... |

### SUN/SDM Configuration (if applicable)
- URL format
- Mirror options
- Backend verification pseudocode

### APDU Sequences

**Personalization:**
```
1. Select application
2. Authenticate with default key
3. Change keys
4. Configure file settings
5. Write initial data
```

**Runtime Operation:**
```
1. ...
```

### Key Management
How keys are generated, stored, and diversified.

### Security Considerations
- Threats to mitigate
- Security best practices

### Implementation Phases
1. Phase 1: ...
2. Phase 2: ...

### Testing Strategy
- Test tag setup
- Backend testing
- Security testing

---

## Feature to Plan

$ARGUMENTS
