# PN532 Knowledge Base

Source: PN532 User Manual (UM0701-02) Rev. 02
Firmware: V1.6 (PN532/C106)
Pages: 200 total, stored in `.claude/agents/pn532-expert/pages/`
Generated: 2026-01-04

## Document Map

| Chapter | Pages | Content |
|---------|-------|---------|
| 1 | 3-5 | Introduction, Glossary |
| 2 | 6-7 | Configuration Modes |
| 3 | 8 | Power Management |
| 4-5 | 9-27 | Pin Description, Interfaces (I2C, SPI, HSU) |
| 6 | 28-64 | Host Controller Communication Protocol |
| 7 | 65-172 | Commands |
| 8+ | 173-200 | Application Notes, Appendices |

## Frame Format (Chapter 6, p.28-34)

### Normal Information Frame
```
┌──────────┬───────┬─────┬─────┬──────────┬─────┬──────────┐
│ PREAMBLE │ START │ LEN │ LCS │ TFI+DATA │ DCS │ POSTAMBLE│
│   0x00   │ 00 FF │     │     │          │     │   0x00   │
└──────────┴───────┴─────┴─────┴──────────┴─────┴──────────┘
```

**Field descriptions:**
- **PREAMBLE** (0x00): Synchronization, can be multiple bytes
- **START CODE** (0x00 0xFF): Start of packet marker
- **LEN**: Length of TFI+DATA (1-255 bytes)
- **LCS**: Length Checksum. Lower byte of (LEN + LCS) = 0x00
- **TFI**: Frame Identifier
  - 0xD4: Host → PN532 (command)
  - 0xD5: PN532 → Host (response)
- **DATA**: Command code + parameters
- **DCS**: Data Checksum. Lower byte of (TFI + DATA[0..n] + DCS) = 0x00
- **POSTAMBLE** (0x00): End marker

### Extended Information Frame (for data > 255 bytes)
```
┌──────────┬───────┬────────┬───────┬─────┬─────┬──────────┬─────┬──────────┐
│ PREAMBLE │ START │ 0xFF FF│ LENM  │LENL │ LCS │ TFI+DATA │ DCS │ POSTAMBLE│
│   0x00   │ 00 FF │        │       │     │     │          │     │   0x00   │
└──────────┴───────┴────────┴───────┴─────┴─────┴──────────┴─────┴──────────┘
```
- LENGTH = LENM × 256 + LENL
- LCS: Lower byte of (LENM + LENL + LCS) = 0x00

### ACK Frame
```
00 00 FF 00 FF 00
```
Used for synchronization and to acknowledge successful frame receipt.

### NACK Frame
```
00 00 FF FF 00 00
```
Request retransmission of previous frame.

### Error Frame
```
00 00 FF 01 FF 7F 81 00
```
Indicates syntax error at application level. Error code in byte after 0x7F.

## Dialog Structure (p.33)

```
Host Controller                    PN532
      │                              │
      │──── Command Packet ─────────>│
      │<─── ACK ────────────────────│
      │                              │ (P70_IRQ goes low)
      │<─── Response Packet ────────│
      │──── ACK (optional) ─────────>│
      │                              │
```

## Command Reference (Chapter 7, p.65-172)

### Command Code Table

#### Miscellaneous
| Command | Code | Page | Description |
|---------|------|------|-------------|
| Diagnose | 0x00 | 69 | Self-diagnosis tests |
| GetFirmwareVersion | 0x02 | 73 | Get IC/firmware version |
| GetGeneralStatus | 0x04 | 74 | Get current status |
| ReadRegister | 0x06 | 76 | Read register value |
| WriteRegister | 0x08 | 76 | Write register value |
| ReadGPIO | 0x0C | 79 | Read GPIO state |
| WriteGPIO | 0x0E | 81 | Write GPIO state |
| SetSerialBaudRate | 0x10 | 83 | Set HSU baud rate |
| SetParameters | 0x12 | 85 | Set various parameters |
| SAMConfiguration | 0x14 | 89 | Configure SAM mode |
| PowerDown | 0x16 | 98 |Enter power-down mode |

#### RF Communication
| Command | Code | Page | Description |
|---------|------|------|-------------|
| RFConfiguration | 0x32 | 101 | Configure RF parameters |
| RFRegulationTest | 0x58 | 107 | RF field test mode |

#### Initiator Commands
| Command | Code | Page | Description |
|---------|------|------|-------------|
| InJumpForDEP | 0x56 | 108 | Jump to DEP mode |
| InJumpForPSL | 0x46 | 113 | Jump for PSL |
| **InListPassiveTarget** | **0x4A** | **115** | **Detect passive targets** |
| InATR | 0x50 | 122 | Attribute request |
| InPSL | 0x4E | 125 | Parameter selection |
| **InDataExchange** | **0x40** | **127** | **Exchange data with target** |
| InCommunicateThru | 0x42 | 136 | Raw communication |
| InDeselect | 0x44 | 139 | Deselect target |
| InRelease | 0x52 | 140 | Release target |
| InSelect | 0x54 | 141 | Select target |
| InAutoPoll | 0x60 | 144 | Automatic polling |

#### Target Commands
| Command | Code | Page | Description |
|---------|------|------|-------------|
| TgInitAsTarget | 0x8C | 151 | Initialize as target |
| TgSetGeneralBytes | 0x92 | 158 | Set general bytes |
| TgGetData | 0x86 | 160 | Get data from initiator |
| TgSetData | 0x8E | 164 | Send data to initiator |
| TgSetMetaData | 0x94 | 166 | Set metadata |
| TgGetInitiatorCommand | 0x88 | 168 | Get initiator command |
| TgResponseToInitiator | 0x90 | 170 | Respond to initiator |
| TgGetTargetStatus | 0x8A | 172 | Get target status |

---

## Key Commands Detail

### GetFirmwareVersion (0x02) - p.73

**Input:**
```
D4 02
```

**Output:**
```
D5 03 IC Ver Rev Support
```

- **IC**: 0x32 for PN532
- **Ver**: Firmware version (0x01 for V1.6)
- **Rev**: Firmware revision (0x06 for V1.6)
- **Support**: Supported features bitmap
  - Bit 0: ISO/IEC 14443 Type A
  - Bit 1: ISO/IEC 14443 Type B
  - Bit 2: ISO18092

**Example (PN532 V1.6):** `D5 03 32 01 06 07`

---

### SAMConfiguration (0x14) - p.89

Configure Security Access Module mode.

**Input:**
```
D4 14 Mode [Timeout] [IRQ]
```

- **Mode**:
  - 0x01: Normal mode (SAM not used) - **default**
  - 0x02: Virtual Card mode
  - 0x03: Wired Card mode
  - 0x04: Dual Card mode
- **Timeout**: Virtual card timeout (50ms units). Optional.
- **IRQ**: P70_IRQ behavior. 0x01 = use IRQ pin. Optional.

**Output:**
```
D5 15
```

**Typical usage (disable SAM):**
```
Input:  D4 14 01
Output: D5 15
```

---

### InListPassiveTarget (0x4A) - p.115-121

Detect and activate passive targets.

**Input:**
```
D4 4A MaxTg BrTy [InitiatorData...]
```

- **MaxTg**: Maximum targets to detect (1 or 2, use 1 for Jewel)
- **BrTy**: Baud rate / target type
  - 0x00: 106 kbps ISO/IEC14443-3 Type A
  - 0x01: 212 kbps FeliCa
  - 0x02: 424 kbps FeliCa
  - 0x03: 106 kbps ISO/IEC14443-3 Type B
  - 0x04: 106 kbps Innovision Jewel tag
- **InitiatorData**: Optional (depends on BrTy)
  - For 106 kbps Type A: Optional UID to select specific card
    - Cascade Level 1: `CT UID0 UID1 UID2 UID3`
    - Cascade Level 2: `CT UID0 UID1 UID2 UID3 CT UID4 UID5 UID6 UID7`

**Output:**
```
D5 4B NbTg [Tg TargetData...]
```

- **NbTg**: Number of targets found (0 if none)
- **Tg**: Target number (1 or 2)
- **TargetData** (for 106 kbps Type A):
  ```
  Tg SENS_RES(2) SEL_RES NFCIDLength NFCID1(4-10) [ATS]
  ```
  - SENS_RES: ATQA (2 bytes)
  - SEL_RES: SAK (1 byte)
  - NFCID1: UID (4, 7, or 10 bytes)
  - ATS: Only if ISO14443-4 compliant

**Example - Detect ISO14443A card:**
```
Input:  D4 4A 01 00
Output: D5 4B 01 01 00 04 08 04 XX XX XX XX
        │     │  │  └─────┴─────┴── NFCID1 (4-byte UID)
        │     │  │  └── NFCIDLength = 4
        │     │  └── SAK (SEL_RES)
        │     └── ATQA (SENS_RES)
        └── 1 target found, target #1
```

---

### InDataExchange (0x40) - p.127-135

Exchange data with an activated target.

**Input:**
```
D4 40 Tg [DataOut...]
```

- **Tg**: Target number (1 or 2). Bit 6 = More Information flag.
- **DataOut**: Data to send (0-262 bytes)

**Output:**
```
D5 41 Status [DataIn...]
```

- **Status**: Error code (0x00 = success)
- **DataIn**: Response data from target

**Status Codes:**
| Code | Meaning |
|------|---------|
| 0x00 | Success |
| 0x01 | Timeout |
| 0x02 | CRC error |
| 0x03 | Parity error |
| 0x04 | Wrong bit count during anti-collision |
| 0x05 | Framing error |
| 0x06 | Abnormal bit-collision |
| 0x07 | Insufficient buffer |
| 0x09 | RF buffer overflow |
| 0x0A | RF field not activated |
| 0x0B | RF protocol error |
| 0x0D | Overheating |
| 0x0E | Internal buffer overflow |
| 0x10 | Invalid parameter |
| 0x12 | DEP command received (target mode) |
| 0x13 | Data format error |
| 0x14 | Authentication error (MIFARE) |
| 0x23 | UID check byte wrong |
| 0x25 | DEP invalid device state |
| 0x26 | Operation not allowed |
| 0x27 | Command not acceptable |
| 0x29 | Released by initiator |
| 0x2A | Card exchanged |
| 0x2B | Card disappeared |
| 0x2C | NFCID3 mismatch |
| 0x2D | Over-current |
| 0x2E | NAD missing |

**Example - MIFARE Read Block 4:**
```
Input:  D4 40 01 30 04        (Tg=1, CMD=0x30 READ, Block=4)
Output: D5 41 00 XX XX XX...  (16 bytes of block data)
```

---

## Typical Initialization Sequence

```
1. Wake up PN532 (send any data, wait for ACK)
2. SAMConfiguration(Mode=0x01)     → Configure normal mode
3. GetFirmwareVersion              → Verify communication
4. RFConfiguration (optional)      → Set RF parameters
5. InListPassiveTarget(1, 0x00)    → Detect ISO14443A card
6. InDataExchange                  → Communicate with card
```

---

## Error Codes (p.67)

| Code | Name | Description |
|------|------|-------------|
| 0x00 | Success | No error |
| 0x01 | Timeout | RF timeout |
| 0x02 | CRC Error | CRC mismatch |
| 0x03 | Parity Error | Parity error |
| 0x04 | BitCount | Wrong bit count (anti-collision) |
| 0x05 | Framing | Framing error |
| 0x06 | BitCollision | Abnormal bit-collision |
| 0x07 | BufferSize | Buffer too small |
| 0x09 | BufferOvfl | RF buffer overflow |
| 0x0A | RFFieldOff | RF field not active |
| 0x0B | ProtocolError | RF protocol error |
| 0x0D | Overheating | Temperature sensor triggered |
| 0x0E | InternalOvfl | Internal buffer overflow |
| 0x10 | InvalidParam | Invalid parameter |
| 0x14 | AuthError | MIFARE authentication failed |

---

## HSU (High Speed UART) Timing (p.34)

| Baud Rate | 1-byte timeout (ms) | 256-byte timeout (ms) |
|-----------|---------------------|----------------------|
| 9600 | 1041.7 | 266.7 |
| 19200 | 520.8 | 133.3 |
| 38400 | 260.4 | 66.7 |
| 57600 | 173.6 | 44.4 |
| 115200 | 86.8 | 22.2 |
| 230400 | 43.4 | 11.1 |
| 460800 | 21.7 | 5.6 |
| 921600 | 10.9 | 2.8 |
| 1288000 | 7.8 | 2.0 |

---

## Page Image Reference

For detailed diagrams and tables, view the page images:
- Frame formats: `page-028.png` to `page-034.png`
- Command table: `page-065.png`, `page-066.png`
- InListPassiveTarget: `page-115.png` to `page-121.png`
- InDataExchange: `page-127.png` to `page-135.png`
- SAMConfiguration: `page-089.png` to `page-097.png`
