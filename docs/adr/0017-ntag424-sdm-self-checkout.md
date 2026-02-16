# ADR-0017: NTAG424 DNA SDM for Self-Checkout

**Status:** Accepted

**Date:** 2026-02-16

**Applies to:** `maco_firmware/apps/personalize/`, `functions/src/ntag/sdm_crypto.ts`

## Context

Users need a way to self-checkout by tapping their NFC tag on any phone, without requiring the machine terminal. NTAG424 DNA supports Secure Dynamic Messaging (SDM), which makes the tag produce a cryptographically signed URL on each tap — containing an encrypted UID, a read counter, and a CMAC signature.

This eliminates the need for a custom app or authenticated session: the phone's NFC reader opens a URL that the backend can verify server-side.

## Decision

### URL Format

```
https://werkstattwaedi.ch/tag?picc=<32 hex chars>&cmac=<16 hex chars>
```

The `/tag` endpoint receives the encrypted PICC data and CMAC. The backend decrypts the UID, verifies the CMAC, and determines the appropriate action (checkout, session view, etc.).

### Key Architecture

| Key | Name | Diversified | Purpose |
|-----|------|-------------|---------|
| 0 | Application | Yes | Master key — changes other keys, authenticates for ChangeFileSettings |
| 1 | Terminal | No (static) | SDMFileReadKey — encrypts UID+counter in PICC data |
| 2 | Authorization | Yes | Card-based mutual authentication at machine terminal |
| 3 | SDM MAC | Yes | SDMMACKey — generates CMAC signature |
| 4 | Reserved2 | Yes | Reserved for future use |

**Why terminal key (Key 1) must be static:**
The backend needs to decrypt the PICC data to learn the tag's UID. But if the decryption key were diversified per-UID, you'd need the UID to compute the key — a chicken-and-egg problem. The terminal key is stored as a Firebase Functions secret (`TERMINAL_KEY`).

**Why CMAC key (Key 3) is diversified:**
After decrypting the UID with the static terminal key, the backend derives Key 3 using `diversifyKey(masterKey, "oww", uid, "sdm_mac")`. This means compromising one tag's CMAC key doesn't affect others.

### NDEF File Configuration

File 0x02 (NDEF) contains an 88-byte NDEF URI record:

| Offset | Content |
|--------|---------|
| 0x00-0x01 | NLEN = 86 |
| 0x02-0x06 | NDEF record header + URI type + "https://" prefix code |
| 0x07-0x21 | `werkstattwaedi.ch/tag?picc=` |
| 0x22-0x41 | PICC placeholder (32 hex zeros → 16 encrypted bytes) |
| 0x42-0x47 | `&cmac=` |
| 0x48-0x57 | CMAC placeholder (16 hex zeros → 8 CMAC bytes) |

### SDM File Settings

ChangeFileSettings payload (15 bytes):

| Field | Value | Meaning |
|-------|-------|---------|
| FileOption | 0x40 | SDM enabled, CommMode Plain |
| AccessRights | 0xE0 0xE0 | Read=free, Write=Key0, RW=free, Change=Key0 |
| SDMOptions | 0xC1 | ASCII(bit0) + SDMReadCtr(bit6) + UID(bit7) |
| SDMAccessRights | 0xFE 0x13 | LE 16-bit: MetaRead=Key1, FileRead=Key3, RFU=F, CtrRet=free |
| PICCDataOffset | 0x22 | Start of encrypted UID+counter |
| SDMMACInputOffset | 0x22 | CMAC computed over PICC data onwards |
| SDMMACOffset | 0x48 | Where CMAC is placed |

### Personalization Flow

1. Identify tag (factory/MaCo/unknown)
2. Fetch diversified keys from Firebase
3. Provision all 5 keys idempotently (Key 0 first, then 1-4)
4. Write NDEF URL template (2 × 44-byte plain-mode writes)
5. Enable SDM via ChangeFileSettings
6. Verify via GetFileSettings

Steps 4-6 are idempotent: `IsSdmConfigured()` compares the full GetFileSettings response against expected values, so if the configuration changes in a future firmware update, re-personalizing will detect the mismatch and reconfigure.

### Backend Verification

```
1. Decrypt PICC with terminal_key → extract UID (7 bytes) + counter (3 bytes)
2. Look up token by UID
3. Derive sdm_mac_key = diversifyKey(masterKey, "oww", uid, "sdm_mac")
4. Derive SV2 = CMAC(sdm_mac_key, 0x3CC3 || 0x0001 || 0x0080 || UID || Counter)
5. Derive SesAuthMACKey = CMAC(sdm_mac_key, 0x02 || SV2)
6. Compute expected CMAC, compare first 8 bytes
```

## Consequences

### Positive

- Users can self-checkout without an app — any NFC phone opens the URL
- Cryptographic security: CMAC prevents URL tampering, counter prevents replay
- Diversified CMAC key limits blast radius of a single compromised tag
- Idempotent personalization supports re-running and future configuration updates

### Negative

- NDEF file committed to specific URL format — changing the domain or path requires re-personalizing all tags

### Risks

- Terminal key must be stored securely (Firebase Functions secret, device secrets flash)
- SDM configuration is permanent until re-personalized with Key 0
