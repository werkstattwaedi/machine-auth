# Explain Task

Provide an in-depth explanation of a PN532 feature, command, or protocol with practical examples.

## Process

### 1. Gather Documentation

1. Read knowledge base at `.claude/agents/pn532-expert/knowledge/overview.md`
2. For specific details, read relevant page images from `.claude/agents/pn532-expert/pages/`
3. Always cite page numbers from the PN532 User Manual

### 2. Analyze the Topic

Understand deeply:
- What is the purpose of this feature/command?
- How does it fit into the overall PN532 operation?
- What are the parameters and their valid ranges?
- What are the expected responses?
- What errors can occur?
- What are common implementation pitfalls?

## Output Format

### Overview
What this feature/command does and when to use it (2-3 paragraphs)

### Command Format
```
Host -> PN532: [command bytes with explanation]
PN532 -> Host: [response bytes with explanation]
```

### Parameters
| Parameter | Offset | Values | Description |
|-----------|--------|--------|-------------|
| ... | ... | ... | ... |

### Frame Construction
Complete frame example with checksums:
```c
// Example: InListPassiveTarget for ISO14443A
uint8_t frame[] = {
    0x00, 0x00, 0xFF,  // Preamble + Start
    0x04,              // LEN
    0xFC,              // LCS (~LEN + 1)
    0xD4,              // TFI (Host to PN532)
    0x4A,              // Command: InListPassiveTarget
    0x01,              // MaxTg: 1 target
    0x00,              // BrTy: 106 kbps Type A
    0xE1,              // DCS
    0x00               // Postamble
};
```

### Response Handling
How to parse the response, including error cases.

### Timing Considerations
Any timing requirements or recommendations from the datasheet.

### Common Mistakes
What to avoid and why (with datasheet references).

### Example Implementation
```c
// Complete working example
```

### Related Commands
Other commands commonly used together with this one.

### Datasheet References
List of relevant pages for further reading.
