/*
 * ASCON Lightweight Cryptography Library
 * NIST Lightweight Cryptography Standard (2023)
 *
 * Implements:
 * - ASCON-AEAD128: Authenticated encryption with 128-bit key
 * - ASCON-Hash256: 256-bit cryptographic hash
 *
 * Reference: https://ascon.iaik.tugraz.at/
 * Based on the reference implementation (CC0 license)
 *
 * SPDX-License-Identifier: CC0-1.0
 */

#ifndef ASCON_H
#define ASCON_H

#include <stddef.h>
#include <stdint.h>

#include "api.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ASCON state (320 bits = 5 x 64-bit words) */
typedef struct {
  uint64_t x[5];
} ascon_state_t;

/*
 * ASCON-AEAD128 Authenticated Encryption
 *
 * Encrypts plaintext and authenticates both ciphertext and associated data.
 *
 * Parameters:
 *   ciphertext: Output buffer for ciphertext (same length as plaintext)
 *   tag: Output buffer for authentication tag (16 bytes)
 *   key: Secret key (16 bytes)
 *   nonce: Unique nonce (16 bytes) - MUST be unique per encryption
 *   ad: Associated data (authenticated but not encrypted), can be NULL
 *   ad_len: Length of associated data
 *   plaintext: Input plaintext
 *   pt_len: Length of plaintext
 *
 * Returns:
 *   0 on success
 */
int ascon_aead128_encrypt(uint8_t* ciphertext,
                          uint8_t tag[ASCON_AEAD128_TAG_BYTES],
                          const uint8_t key[ASCON_AEAD128_KEY_BYTES],
                          const uint8_t nonce[ASCON_AEAD128_NONCE_BYTES],
                          const uint8_t* ad,
                          size_t ad_len,
                          const uint8_t* plaintext,
                          size_t pt_len);

/*
 * ASCON-AEAD128 Authenticated Decryption
 *
 * Decrypts ciphertext and verifies authenticity of both ciphertext and
 * associated data.
 *
 * Parameters:
 *   plaintext: Output buffer for plaintext (same length as ciphertext)
 *   key: Secret key (16 bytes)
 *   nonce: Nonce used during encryption (16 bytes)
 *   ad: Associated data (must match what was used during encryption)
 *   ad_len: Length of associated data
 *   ciphertext: Input ciphertext
 *   ct_len: Length of ciphertext
 *   tag: Authentication tag to verify (16 bytes)
 *
 * Returns:
 *   0 on success (authentication verified)
 *   -1 on authentication failure (data may be tampered)
 */
int ascon_aead128_decrypt(uint8_t* plaintext,
                          const uint8_t key[ASCON_AEAD128_KEY_BYTES],
                          const uint8_t nonce[ASCON_AEAD128_NONCE_BYTES],
                          const uint8_t* ad,
                          size_t ad_len,
                          const uint8_t* ciphertext,
                          size_t ct_len,
                          const uint8_t tag[ASCON_AEAD128_TAG_BYTES]);

/*
 * ASCON-Hash256 Cryptographic Hash
 *
 * Computes a 256-bit hash of the input message.
 *
 * Parameters:
 *   hash: Output buffer (32 bytes)
 *   message: Input message
 *   msg_len: Length of message
 *
 * Returns:
 *   0 on success
 */
int ascon_hash256(uint8_t hash[ASCON_HASH256_BYTES],
                  const uint8_t* message,
                  size_t msg_len);

/*
 * Internal: ASCON permutation
 * Applies the ASCON permutation with specified number of rounds.
 */
void ascon_permutation(ascon_state_t* state, int rounds);

#ifdef __cplusplus
}
#endif

#endif /* ASCON_H */
