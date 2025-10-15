# NTAG424 DNA Secure Checkout with SDM

## Overview

This document describes the implementation of secure, unauthenticated checkout using NTAG424 DNA's SDM (Secure Dynamic Messaging) feature. The system allows users to checkout by tapping their NFC tag, without requiring authentication, while maintaining cryptographic security.

## Key Architecture

### NTAG424 DNA Keys

The system uses the following key configuration:

- **Key 0 (application)**: Diversified, used for session authentication
- **Key 1 (terminal_key)**: Static (non-diversified), used for UID encryption in SDM
- **Key 2 (authorization)**: Diversified, used for card-based authentication
- **Key 3 (reserved1)**: Diversified, used for SDM CMAC signature
- **Key 4 (reserved2)**: Reserved for future use

### SDM Configuration

**Key Selection Rationale:**

- **SDMFileReadKey = Key 1 (terminal_key)**
  - Must be static (non-diversified) to decrypt UID without knowing UID first
  - Solves chicken-egg problem: need UID to compute diversified key, but need to decrypt UID first
  - Stored as Firebase Functions secret `TERMINAL_KEY`

- **SDMMACKey = Key 3 (reserved1)**
  - Diversified per tag for improved security
  - Computed on-demand using `diversifyKey(masterKey, "oww", uid, "reserved1")`
  - Not stored anywhere - derived when needed

## Checkout Flow

### 1. User Experience

```
User taps NFC tag → https://werkstattwaedi.ch/checkout/tag?picc=<encrypted>&cmac=<sig>
                   ↓
              Shows usage summary:
              - "Fräse - 15 min"
              - "Laser - 30 min"
              - [Zur Kasse] button
                   ↓
              Redirects to Cognitoforms with prefilled data
```

### 2. Technical Flow

```
1. Tag URL opens checkout page with picc + cmac parameters
2. Page calls Firebase function: POST /verifyTagCheckout
3. Function:
   a. Decrypt PICC using TERMINAL_KEY → extract UID + counter
   b. Look up token in Firestore by UID
   c. Compute reserved1_key = diversifyKey(MASTER_KEY, "oww", uid, "reserved1")
   d. Derive SV2 session keys from terminal_key
   e. Verify CMAC using reserved1_key + SV2
   f. Return { tokenId, userId } if valid
4. Page:
   a. Fetch open sessions for user
   b. Calculate usage per machine
   c. Close all sessions
   d. Build Cognitoforms URL with usage data
   e. Redirect to payment
```

## Cryptographic Details

### SV2 Session Key Derivation

The SV2 (Session Value 2) is used to derive session-specific encryption and MAC keys:

```
SV2 = CMAC(terminal_key, 0x3CC3 || 0x0001 || 0x0080 || UID || Counter)
SesAuthEncKey = CMAC(terminal_key, 0x01 || SV2)
SesAuthMACKey = CMAC(terminal_key, 0x02 || SV2)
```

### PICC Data Encryption

```
Encrypted PICC = AES-128-CBC(terminal_key, UID || Counter || padding)
  - Key: terminal_key (16 bytes)
  - IV: All zeros (16 bytes)
  - Data: UID (7 bytes) + Counter (3 bytes) + padding (6 bytes) = 16 bytes
```

### CMAC Verification

```
1. Decrypt PICC to get UID and Counter
2. Look up token by UID to get userId
3. Derive reserved1_key = diversifyKey(MASTER_KEY, "oww", UID, "reserved1")
4. Derive SV2 = CMAC(terminal_key, prefix || UID || Counter)
5. Derive session keys from SV2
6. Compute expected CMAC = CMAC(SesAuthMACKey, UID || Counter)
7. Compare first 8 bytes with provided CMAC
```

## Implementation

### Backend (Firebase Functions)

**Files:**
- `functions/src/ntag/sdm_crypto.ts` - SV2 derivation, AES decryption, CMAC verification
- `functions/src/checkout/verify_tag.ts` - Tag verification endpoint handler
- `functions/src/index.ts` - Public endpoint registration

**Secrets:**
```bash
firebase functions:secrets:set TERMINAL_KEY
# Enter: 32 hex characters (16 bytes)
# For dev: use DEV_FACTORY_DATA.key from firmware
```

### Frontend (Angular Admin UI)

**Files:**
- `admin/src/app/core/models/session.model.ts` - Session and usage models
- `admin/src/app/core/services/session.service.ts` - Session management
- `admin/src/app/features/checkout/` - Checkout component
- `admin/src/app/app.routes.ts` - Routes configuration

**Routes:**
- `/checkout/tag?picc=xxx&cmac=yyy` - Public NFC tag checkout
- `/checkout` - Authenticated user checkout

## Future: Tag Configuration

### SDM File Settings (To Be Implemented)

When personalizing tags, configure NDEF file (File 02) with SDM:

```cpp
// 1. Write NDEF URL template:
//    "https://werkstattwaedi.ch/checkout/tag?picc=00000000000000000000000000000000&cmac=0000000000000000"

// 2. Call DNA_Full_ChangeFileSettings with:
SDMOptions:
  - Bit 7: UID mirror enabled
  - Bit 6: SDMReadCtr enabled
  - Bit 5: ASCII encoding
  - Bit 4: Encrypt file data

Offsets (in URL):
  - PICCDataOffset: Position of UID+counter in URL (e.g., 0x32)
  - SDMENCOffset: Start of encrypted data (e.g., 0x32)
  - SDMENCLength: Length of encrypted section (32 hex chars = 16 bytes)
  - SDMMACOffset: Position of CMAC (e.g., 0x52)

Keys:
  - SDMFileReadKey: Key 1 (terminal_key)
  - SDMMACKey: Key 3 (reserved1)
```

## Security Considerations

### Strengths

1. **CMAC prevents tampering**: Cannot modify URL without knowing reserved1 key
2. **Counter prevents replay**: Read counter increments each tap
3. **Diversified CMAC key**: Compromising one tag doesn't affect others
4. **No secrets in URL**: Only encrypted data and signature

### Limitations

1. **Terminal key exposure**: All tags use same encryption key
   - Mitigation: Store securely as Firebase secret
   - If leaked: Can decrypt UID but cannot forge CMAC (different key)

2. **Counter wraps at 2^24**: ~16M reads per tag
   - Acceptable for expected usage patterns

## Testing

**Manual Testing:**

1. Set TERMINAL_KEY secret:
   ```bash
   cd functions
   firebase functions:secrets:set TERMINAL_KEY
   # For dev: 00000000000000000000000000000000
   ```

2. Deploy functions:
   ```bash
   npm run build
   firebase deploy --only functions
   ```

3. Test verification endpoint:
   ```bash
   curl -X POST https://REGION-PROJECT.cloudfunctions.net/api/verifyTagCheckout \
     -H "Content-Type: application/json" \
     -d '{"picc":"<hex>","cmac":"<hex>"}'
   ```

4. Test checkout page:
   - Navigate to `/checkout/tag?picc=xxx&cmac=yyy`
   - Should show usage summary if valid

## References

- NXP NTAG 424 DNA Datasheet (NT4H2421Gx)
- NXP AN12196: NTAG 424 DNA features and hints
- NIST SP 800-38B: CMAC specification
- Project key diversification: `functions/src/ntag/key_diversification.ts`

## TODO

- [ ] Implement SDM configuration in tag personalization flow
- [ ] Add Cognitoforms URL configuration
- [ ] Add integration tests for SDM crypto
- [ ] Monitor counter values and alert on wrap-around
