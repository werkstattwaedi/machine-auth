---
description: Plan a PN532 driver feature implementation. Use before implementing NFC communication, card detection, or protocol handling.
---

# PN532 Driver Planning

You are helping plan a PN532 driver feature implementation. This requires understanding the hardware interfaces, frame formats, and NFC protocols.

## Knowledge Base

- **Agent reference**: `.claude/agents/pn532-expert.md`
- **Pre-processed knowledge**: `.claude/agents/pn532-expert/knowledge/overview.md`
- **Page images**: `.claude/agents/pn532-expert/pages/`
- **Source PDF**: `docs/proprietary/Pn532um.pdf`

## Instructions

### Phase 1: Understand Requirements

First, analyze what the user is trying to build:
- What NFC functionality is needed (read/write cards, card emulation, peer-to-peer)?
- What card types need to be supported (ISO14443A, ISO14443B, FeliCa)?
- What communication interface is being used (HSU, I2C, SPI)?
- What are the constraints (response time, power, reliability)?

If requirements are unclear, ask clarifying questions.

### Phase 2: Check Documentation

1. Read `.claude/agents/pn532-expert/knowledge/overview.md` for command reference
2. For specific command details, read relevant page images
3. Always cite page numbers

### Phase 3: Command Sequence Design

For the feature, determine:
- What initialization sequence is needed?
- What commands will be used?
- What are the expected responses?
- What error conditions need handling?

Consider the typical sequence:
1. SAMConfiguration (always first after reset)
2. RFConfiguration (optional tuning)
3. InListPassiveTarget (detect cards)
4. InDataExchange / InCommunicateThru (communicate with card)
5. InRelease / InDeselect (cleanup)

### Phase 4: Frame Format Design

Design the communication:
- Frame construction with proper checksums
- ACK handling
- Response parsing
- Error recovery

### Phase 5: Implementation Strategy

Create a concrete plan:
- What order should things be built?
- What abstraction layers are needed?
- How to handle interface-specific requirements?
- What tests can be written?

## Output Format

### Summary
Brief overview of the recommended approach

### Command Sequence
| Step | Command | Purpose |
|------|---------|---------|
| 1 | SAMConfiguration | Initialize SAM |
| 2 | ... | ... |

### Frame Examples
```c
// Key frames with full construction
uint8_t cmd[] = { ... };
```

### Interface Considerations
Specific notes for the chosen interface (I2C/SPI/HSU)

### Error Handling
- Error conditions to handle
- Recovery strategies

### Implementation Phases
1. Phase 1: ...
2. Phase 2: ...

### Testing Strategy
- How to test without hardware
- Mock/simulation approaches

### Datasheet References
Key pages for implementation details

---

## Feature to Plan

$ARGUMENTS
