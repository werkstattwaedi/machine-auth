# PN532 NFC Controller Skill

This skill provides expert knowledge for interfacing with the PN532 NFC controller.

## Activation Triggers

Activate this skill when the context includes:
- Code with PN532 references (class names, defines, includes)
- NFC/RFID communication code patterns
- Frame construction matching PN532 format (0x00 0x00 0xFF preamble)
- Commands like InListPassiveTarget, InDataExchange, SAMConfiguration
- I2C address 0x24 or 0x48 in NFC context
- ISO14443, MIFARE, FeliCa, NDEF protocol handling

## Keyword Detection
- `pn532`, `PN532`
- `InListPassiveTarget`, `InDataExchange`, `SAMConfiguration`
- `0xD4` (host to PN532 TFI)
- `MIFARE`, `ISO14443`, `FeliCa`, `NFCIP`
- `NFC_`, `nfc_`, `Nfc` combined with read/write/poll/detect

## When to Consult @pn532-expert

Invoke the `pn532-expert` agent for:
- Detailed register values, timing specs, or protocol details
- Complex frame construction or debugging
- Deep analysis of communication sequences

The agent has access to detailed knowledge in `.claude/agents/pn532-expert/` and datasheet at `docs/proprietary/Pn532um.pdf`.

## Proactive Behaviors

### Frame Construction
When seeing manual frame building, verify:
- Preamble: 0x00 0x00 0xFF
- LCS = ~LEN + 1 (two's complement)
- DCS = ~(sum of TFI + DATA) + 1
- Postamble: 0x00

Flag if checksums appear incorrect.

### Command Sequences
Suggest proper sequences:
- Reset -> SAMConfiguration before any card operations
- InListPassiveTarget -> InDataExchange for card communication
- Authentication before protected MIFARE sectors

### Common Anti-Patterns

| Pattern | Issue | Suggestion |
|---------|-------|------------|
| No ACK check after command | May miss errors | Always verify ACK before reading response |
| Fixed delays instead of IRQ/ready | Inefficient, unreliable | Use interrupt or poll ready signal |
| Ignoring error byte in response | Silent failures | Check byte after response code |
| No timeout on card operations | Can hang forever | Set appropriate RFConfiguration timeouts |
| RF field always on | Wastes power, heats antenna | Disable between operations if battery powered |

### Interface-Specific Guidance

**I2C Mode:**
- Poll ready bit or use IRQ line
- Handle clock stretching
- Use repeated start for read after write

**SPI Mode:**
- Status read before data read
- Watch for busy flag
- Proper SS timing

**HSU Mode:**
- Wake up with extended preamble if sleeping
- Handle baud rate configuration
- Watch for frame sync issues

