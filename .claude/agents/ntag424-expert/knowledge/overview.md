# NTAG 424 DNA Knowledge Base

## Sources
- **NTAG 424 DNA Datasheet** (NT4H2421Gx) Rev 3.0, Jan 2019 (97 pages) → `.claude/agents/ntag424-expert/pages/datasheet/`
- **AN12196** Rev 1.9, Aug 2024 (60 pages) → `.claude/agents/ntag424-expert/pages/an12196/`

Generated: 2026-01-04

## Document Map

### Datasheet
| Chapter | Pages | Content |
|---------|-------|---------|
| 8.2 | 10-12 | File structure, Access rights |
| 9.2 | 30-32 | MAC/Encryption, Auth commands |
| 9.3 | 40-42 | SDM/SDMMAC session keys |
| 10.4 | 50-52 | AuthenticateLRPFirst |
| 10.5 | 60-64 | GetVersion, GetCardUID |
| 10.6 | 62 | ChangeKey |
| 10.7 | 65-71 | ChangeFileSettings, GetFileSettings |
| 10.8 | 73-76 | ReadData, WriteData |
| 10.9 | 77-78 | ISOSelectFile |

### AN12196
| Section | Pages | Content |
|---------|-------|---------|
| 3.4 | 10-17 | SUN Mirroring (PICCData, SDMMAC) |
| 4.3-4.4 | 20-22 | CommMode.MAC/Full examples |
| 5 | 23-27 | Personalization example steps |

---

## Memory Organization (Datasheet p.10)

| File | ID | Size | Purpose |
|------|-----|------|---------|
| CC | 01h | 32 bytes | Capability Container (NDEF) |
| NDEF | 02h | 256 bytes | NDEF message, SDM data |
| Proprietary | 03h | 128 bytes | Custom application data |

**Total user memory:** 416 bytes (Standard) or 256 bytes

---

## File Access Rights (Datasheet p.11-12)

### Access Conditions
| Value | Meaning |
|-------|---------|
| 0h-4h | Key 0-4 required |
| Eh | Free access |
| Fh | No access (denied) |

### Default Access Rights
| File | Read | Write | ReadWrite | Change |
|------|------|-------|-----------|--------|
| 01h (CC) | Eh | Fh | Fh | 0h |
| 02h (NDEF) | Eh | Eh | Eh | 0h |
| 03h (Prop) | 0h | 0h | 0h | 0h |

---

## Command Reference

### ISOSelectFile (INS 0xA4) - Datasheet p.77-78

Select NTAG 424 DNA application or file.

**Select Application (DF Name):**
```
CLA INS P1  P2  Lc  Data                    Le
00  A4  04  00  07  D2760000850101          00
```

**Response:** `9000` (success)

**Select File by FileNo:**
```
90  A4  00  00  03  [CmdHdr][FileNo]        00
```

### AuthenticateEV2First (INS 0x71) - Datasheet p.50-52

Start AES-128 mutual authentication (first part).

**Command:**
```
90  71  00  00  02  [KeyNo][LenCap]         00
```

- **KeyNo**: Key number (0-4)
- **LenCap**: Length of PCD capabilities (typically 0x00)

**Response Part 1:**
```
[RndB_enc (16 bytes)]  91AF
```

**Command Part 2:**
```
90  AF  00  00  20  [RndA || RndB' encrypted]  00
```

**Response Part 2:**
```
[TI (4) || RndA' (16) || PDcap2 (6) || PCDcap2 (6)]  9100
```

### AuthenticateLRPFirst (INS 0x71) - Datasheet p.51-52

LRP secure messaging authentication (similar flow to EV2).

**Command:**
```
90  71  00  00  02  [KeyNo][LenCap]         00
```
With AuthMode bit set for LRP.

---

## Authentication Flow (Datasheet p.31, AN12196 p.20)

```
    PCD (Host)                           PICC (Tag)
        │                                    │
        │──AuthEV2First(KeyNo, LenCap)──────>│
        │<────────[RndB_enc, 91AF]───────────│
        │                                    │
        │  Dec(RndB), Gen(RndA)              │
        │  RndB' = RndB rotated left 1 byte  │
        │  Enc(RndA || RndB')                │
        │                                    │
        │──[RndA||RndB' enc, AF]────────────>│
        │<──[TI||RndA'||caps, 9100]──────────│
        │                                    │
     [Both derive session keys]
```

### Session Key Derivation (Datasheet p.32, AN12196 p.41)

```
SV1 = 0xA5 || 0x5A || 0x00 || 0x01 || 0x00 || 0x80 || RndA[15..14] ||
      (RndA[13..8] XOR RndB[15..10]) || RndB[9..0] || RndA[7..0]

SV2 = 0x5A || 0xA5 || 0x00 || 0x01 || 0x00 || 0x80 || RndA[15..14] ||
      (RndA[13..8] XOR RndB[15..10]) || RndB[9..0] || RndA[7..0]

SessAuthENCKey = AES(Key, SV1)
SesAuthMACKey = AES(Key, SV2)
```

---

## ReadData (INS 0xAD) - Datasheet p.73-74

Read data from StandardData file.

**Command:**
```
90  AD  00  00  07  [CmdHdr][FileNo][Offset(3)][Length(3)]  00
```

- **Offset**: 3 bytes, LSB first (000000h = start)
- **Length**: 3 bytes, LSB first (000000h = read all)

**Response (Plain):**
```
[Data]  9100
```

**Response (MAC/Full):** Includes MAC for verification.

---

## WriteData (INS 0x8D) - Datasheet p.75-76

Write data to StandardData file.

**Command (Plain):**
```
90  8D  00  00  Lc  [CmdHdr][FileNo][Offset(3)][Length(3)][Data]  00
```

**Command (CommMode.Full):** Data encrypted + MAC appended.

**Response:** `9100` (success)

---

## ChangeFileSettings (INS 0x5F) - Datasheet p.65-68

Change access parameters of a file.

**Command:**
```
90  5F  00  00  Lc  [CmdHdr][FileNo][FileOption][AccessRights(2)][SDMOptions][...]  00
```

### FileOption Byte
| Bit | Name | Description |
|-----|------|-------------|
| 6 | SDM | Enable Secure Dynamic Messaging |
| 0-5 | CommMode | 00=Plain, 01=MAC, 11=Full |

### SDMOptions Byte (Datasheet p.65, Table 69)
| Bit | Name | Description |
|-----|------|-------------|
| 7 | UID | UID mirroring (1=enabled, 0=disabled) |
| 6 | SDMReadCtr | Read counter mirroring (1=enabled, 0=disabled) |
| 5 | SDMReadCtrLimit | Enable read counter limit (requires 3-byte limit value!) |
| 4 | SDMENCFileData | Encrypt file data (requires SDMENCOffset+SDMENCLength!) |
| 3-1 | RFU | Must be 000. Setting → 0x9E Parameter Error |
| 0 | ASCII | Encoding mode (1=ASCII hex, 0=binary) |

**IMPORTANT:**
- Bits 3-1 are reserved and MUST be 0. Setting them causes 0x9E Parameter Error.
- Bit 7 (UID) and bit 6 (SDMReadCtr) control WHAT is mirrored. SDMMetaRead controls HOW
  (encrypted vs plain). Both bits must be set to include UID+ReadCtr.
- When SDMMetaRead != Eh (encrypted mode): PICCDataOffset replaces UIDOffset+SDMReadCtrOffset.
  But UID/ReadCtr bits must still be set, or PICCDataOffset won't be expected → 0x7E Length Error.
- For encrypted PICC data (UID+ReadCtr) + CMAC: SDMOptions = 0xC1 (bits 0, 6, 7).
  This matches AN12196 personalization example.

### SDMAccessRights (2 bytes LE, Datasheet p.66)

16-bit field (little-endian on wire, low byte first):
| Bits | Field | Description |
|------|-------|-------------|
| 15-12 | SDMMetaRead | Key for PICCData (0-4=key, E=plain, F=none) |
| 11-8 | SDMFileRead | Key for CMAC verification (0-4=key, E=free, F=none) |
| 7-4 | RFU | Set to Fh |
| 3-0 | SDMCtrRet | Key for counter retrieval (0-4=key, E=free, F=none) |

**Wire byte order (little-endian):**
- Byte 0 (low) = `[RFU:4][SDMCtrRet:4]`
- Byte 1 (high) = `[SDMMetaRead:4][SDMFileRead:4]`

Example: MetaRead=1, FileRead=3, RFU=F, CtrRet=E → 16-bit=0x13FE → wire=**0xFE 0x13**
AN12196 example: MetaRead=2, FileRead=1, RFU=F, CtrRet=1 → 16-bit=0x21F1 → wire=**0xF1 0x21** (displayed as "F121")

---

## SUN/SDM Configuration (AN12196 p.10-17)

### URL Template Structure
```
https://example.com/v?picc_data=00000000000000000000000000000000&cmac=0000000000000000
                      └────────── ENC_PICC_DATA ──────────────┘     └──── CMAC ────┘
```

### PICCData Mirroring (AN12196 p.10)

**Encrypted PICCData** (16 bytes when UID+Ctr enabled):
```
ENC(SDMMetaReadKey, UID || SDMReadCtr || padding)
```

**Decryption yields:**
- Bytes 0-6: UID (7 bytes)
- Bytes 7-9: SDMReadCtr (3 bytes, LSB first)
- Bytes 10-15: Random padding

### SDMMAC/CMAC Calculation (AN12196 p.14-17)

**When CMACInputOffset == CMACOffset (no encrypted file data):**
```
SDMMAC = CMAC(SesSDMFileReadMACKey, SDMReadCtr(3 bytes, with padding))
```

**When CMACInputOffset != CMACOffset:**
```
SDMMAC = CMAC(SesSDMFileReadMACKey,
              DynamicFileData || SDMReadCtr || padding)
```

### Session Key for SDM (AN12196 p.41)

```
SesSDMFileReadMACKey = CMAC(SDMFileReadKey, SV)

SV = 0x3C || 0xC3 || 0x00 || 0x01 || 0x00 || 0x80 ||
     UID(7) || SDMReadCtr(3) || padding(zeros to 16 bytes)
```

---

## Communication Modes (AN12196 p.20-22)

### CommMode.Plain
- No encryption, no MAC
- Data sent/received in clear

### CommMode.MAC (AN12196 p.20)
```
PCD → PICC: Cmd || CmdHdr || CmdData || MAC(8 bytes)
PICC → PCD: RespData || MAC(8 bytes) || SW
```

### CommMode.Full (AN12196 p.21)
```
PCD → PICC: Cmd || CmdHdr || ENC(CmdData) || MAC
PICC → PCD: ENC(RespData || padding) || MAC || SW
```

**Encryption:** AES-128-CBC with IV derived from command counter.

---

## GetFileSettings Response (Datasheet p.69-70)

| Field | Length | Description |
|-------|--------|-------------|
| FileType | 1 | 00h = StandardData |
| FileOption | 1 | CommMode + SDM flag |
| AccessRights | 2 | R/W/RW/Change keys |
| FileSize | 3 | LSB first |
| SDMOptions | 1 | (if SDM enabled) |
| SDMAccessRights | 2 | (if SDM enabled) |
| UIDOffset | 3 | (if UID mirroring) |
| SDMReadCtrOffset | 3 | (if counter mirroring) |
| PICCDataOffset | 3 | (if encrypted PICCData) |
| SDMMACInputOffset | 3 | CMAC calculation start |
| SDMENCOffset | 3 | (if encrypted file data) |
| SDMENCLength | 3 | (if encrypted file data) |
| SDMMACOffset | 3 | CMAC placeholder position |
| SDMReadCtrLimit | 3 | (if limit enabled) |

---

## Status Codes (Datasheet p.50, 52, 63, etc.)

| SW | Name | Description |
|----|------|-------------|
| 9100 | SUCCESS | Command successful |
| 91AF | ADDITIONAL_FRAME | More data expected |
| 91AE | AUTHENTICATION_ERROR | Auth failed |
| 917E | LENGTH_ERROR | Invalid length |
| 919E | PARAMETER_ERROR | Invalid parameter |
| 919D | PERMISSION_DENIED | Access denied |
| 91BE | BOUNDARY_ERROR | Outside file bounds |
| 91CA | COMMAND_ABORTED | Chained command ongoing |
| 911E | INTEGRITY_ERROR | MAC/checksum failed |
| 9140 | NO_SUCH_KEY | Key doesn't exist |
| 91F0 | FILE_NOT_FOUND | File doesn't exist |
| 91EE | MEMORY_ERROR | EEPROM write failure |

---

## Backend Verification (AN12196 p.10-17)

1. **Parse URL** - Extract ENC_PICC_DATA and CMAC from URL
2. **Derive session key:**
   ```
   SesSDMFileReadMACKey = CMAC(SDMFileReadKey, SV)
   ```
3. **Decrypt PICCData** (if encrypted):
   ```
   PICCData = AES_DEC(SesSDMMetaReadKey, ENC_PICC_DATA)
   UID = PICCData[0:7]
   SDMReadCtr = PICCData[7:10]  # LSB first
   ```
4. **Verify counter** - Must be > last seen (replay protection)
5. **Calculate expected CMAC:**
   ```
   expected_CMAC = CMAC(SesSDMFileReadMACKey, input_data)
   ```
6. **Compare CMACs** - Use constant-time comparison!

---

## Personalization Steps (AN12196 p.23)

1. ISO14443-4 PICC Activation
2. Originality signature verification (optional)
3. ISOSelectFile (DF Name: D2760000850101)
4. GetFileSettings for file 02h
5. GetVersion to confirm IC
6. AuthenticateEV2First with AppMasterKey (Key 0)
7. Prepare NDEF data
8. WriteData to file 02h (NDEF file)
9. ChangeFileSettings to enable SDM
10. ISOSelectFile file 02h (for read test)
11. WriteData to file 03h (Proprietary)
12. AuthenticateEV2First (confirm new settings)
13. WriteData verification
14. ChangeKey (optional - diversify keys)

---

## Page Image Reference

**Datasheet:**
- File structure: `datasheet/page-10.png` to `page-12.png`
- Authentication: `datasheet/page-30.png` to `page-32.png`
- SDM keys: `datasheet/page-40.png` to `page-42.png`
- AuthenticateLRPFirst: `datasheet/page-51.png`, `page-52.png`
- Commands: `datasheet/page-60.png` to `page-78.png`

**AN12196:**
- SUN mirroring: `an12196/page-10.png` to `page-17.png`
- CommMode examples: `an12196/page-20.png` to `page-22.png`
- Personalization: `an12196/page-23.png` to `page-27.png`
