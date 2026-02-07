/*
 * ASCON-AEAD128 Implementation
 * Authenticated Encryption with Associated Data
 *
 * SPDX-License-Identifier: CC0-1.0
 */

#include "ascon.h"

#include <string.h>

/* ASCON-AEAD128 rate (8 bytes) */
#define RATE 8

/* Initialization vector for ASCON-AEAD128 */
#define IV                                                                     \
  (((uint64_t)(ASCON_AEAD128_KEY_BYTES * 8) << 56) |                            \
   ((uint64_t)(RATE * 8) << 48) | ((uint64_t)12 << 40) | ((uint64_t)6 << 32))

/* Load 64-bit big-endian value */
static inline uint64_t load64(const uint8_t* p) {
  return ((uint64_t)p[0] << 56) | ((uint64_t)p[1] << 48) |
         ((uint64_t)p[2] << 40) | ((uint64_t)p[3] << 32) |
         ((uint64_t)p[4] << 24) | ((uint64_t)p[5] << 16) |
         ((uint64_t)p[6] << 8) | (uint64_t)p[7];
}

/* Store 64-bit big-endian value */
static inline void store64(uint8_t* p, uint64_t x) {
  p[0] = (uint8_t)(x >> 56);
  p[1] = (uint8_t)(x >> 48);
  p[2] = (uint8_t)(x >> 40);
  p[3] = (uint8_t)(x >> 32);
  p[4] = (uint8_t)(x >> 24);
  p[5] = (uint8_t)(x >> 16);
  p[6] = (uint8_t)(x >> 8);
  p[7] = (uint8_t)x;
}

/* XOR partial block into state */
static void xor_bytes(uint64_t* word, const uint8_t* bytes, size_t len) {
  uint8_t temp[8] = {0};
  store64(temp, *word);
  for (size_t i = 0; i < len; i++) {
    temp[i] ^= bytes[i];
  }
  *word = load64(temp);
}

/* Extract bytes from state word */
static void extract_bytes(uint64_t word, uint8_t* out, size_t len) {
  uint8_t temp[8];
  store64(temp, word);
  for (size_t i = 0; i < len; i++) {
    out[i] = temp[i];
  }
}

int ascon_aead128_encrypt(uint8_t* ciphertext,
                          uint8_t tag[ASCON_AEAD128_TAG_BYTES],
                          const uint8_t key[ASCON_AEAD128_KEY_BYTES],
                          const uint8_t nonce[ASCON_AEAD128_NONCE_BYTES],
                          const uint8_t* ad,
                          size_t ad_len,
                          const uint8_t* plaintext,
                          size_t pt_len) {
  ascon_state_t s;
  uint64_t k0 = load64(key);
  uint64_t k1 = load64(key + 8);
  uint64_t n0 = load64(nonce);
  uint64_t n1 = load64(nonce + 8);

  /* Initialization */
  s.x[0] = IV;
  s.x[1] = k0;
  s.x[2] = k1;
  s.x[3] = n0;
  s.x[4] = n1;

  ascon_permutation(&s, 12);

  s.x[3] ^= k0;
  s.x[4] ^= k1;

  /* Process associated data */
  if (ad_len > 0) {
    size_t i = 0;
    /* Full blocks */
    while (i + RATE <= ad_len) {
      s.x[0] ^= load64(ad + i);
      ascon_permutation(&s, 6);
      i += RATE;
    }
    /* Partial block + padding */
    {
      uint8_t temp[8] = {0};
      size_t rem = ad_len - i;
      for (size_t j = 0; j < rem; j++) {
        temp[j] = ad[i + j];
      }
      temp[rem] = 0x80;  /* Padding: 10* pattern */
      xor_bytes(&s.x[0], temp, RATE);
    }
    ascon_permutation(&s, 6);
  }

  /* Domain separation */
  s.x[4] ^= 1;

  /* Encrypt plaintext */
  size_t i = 0;
  /* Full blocks */
  while (i + RATE <= pt_len) {
    s.x[0] ^= load64(plaintext + i);
    store64(ciphertext + i, s.x[0]);
    ascon_permutation(&s, 6);
    i += RATE;
  }
  /* Partial block */
  if (i < pt_len) {
    size_t rem = pt_len - i;
    xor_bytes(&s.x[0], plaintext + i, rem);
    extract_bytes(s.x[0], ciphertext + i, rem);
    /* Padding */
    uint8_t temp[8] = {0};
    temp[rem] = 0x80;
    xor_bytes(&s.x[0], temp, RATE);
  } else {
    /* Padding when plaintext is multiple of rate */
    s.x[0] ^= 0x8000000000000000ULL;
  }

  /* Finalization */
  s.x[1] ^= k0;
  s.x[2] ^= k1;
  ascon_permutation(&s, 12);
  s.x[3] ^= k0;
  s.x[4] ^= k1;

  /* Output tag */
  store64(tag, s.x[3]);
  store64(tag + 8, s.x[4]);

  return 0;
}

int ascon_aead128_decrypt(uint8_t* plaintext,
                          const uint8_t key[ASCON_AEAD128_KEY_BYTES],
                          const uint8_t nonce[ASCON_AEAD128_NONCE_BYTES],
                          const uint8_t* ad,
                          size_t ad_len,
                          const uint8_t* ciphertext,
                          size_t ct_len,
                          const uint8_t tag[ASCON_AEAD128_TAG_BYTES]) {
  ascon_state_t s;
  uint64_t k0 = load64(key);
  uint64_t k1 = load64(key + 8);
  uint64_t n0 = load64(nonce);
  uint64_t n1 = load64(nonce + 8);

  /* Initialization */
  s.x[0] = IV;
  s.x[1] = k0;
  s.x[2] = k1;
  s.x[3] = n0;
  s.x[4] = n1;

  ascon_permutation(&s, 12);

  s.x[3] ^= k0;
  s.x[4] ^= k1;

  /* Process associated data */
  if (ad_len > 0) {
    size_t i = 0;
    /* Full blocks */
    while (i + RATE <= ad_len) {
      s.x[0] ^= load64(ad + i);
      ascon_permutation(&s, 6);
      i += RATE;
    }
    /* Partial block + padding */
    {
      uint8_t temp[8] = {0};
      size_t rem = ad_len - i;
      for (size_t j = 0; j < rem; j++) {
        temp[j] = ad[i + j];
      }
      temp[rem] = 0x80;  /* Padding: 10* pattern */
      xor_bytes(&s.x[0], temp, RATE);
    }
    ascon_permutation(&s, 6);
  }

  /* Domain separation */
  s.x[4] ^= 1;

  /* Decrypt ciphertext */
  size_t i = 0;
  /* Full blocks */
  while (i + RATE <= ct_len) {
    uint64_t c = load64(ciphertext + i);
    store64(plaintext + i, s.x[0] ^ c);
    s.x[0] = c;
    ascon_permutation(&s, 6);
    i += RATE;
  }
  /* Partial block */
  if (i < ct_len) {
    size_t rem = ct_len - i;
    uint8_t temp[8];
    store64(temp, s.x[0]);
    for (size_t j = 0; j < rem; j++) {
      plaintext[i + j] = temp[j] ^ ciphertext[i + j];
      temp[j] = ciphertext[i + j];
    }
    /* Padding */
    temp[rem] ^= 0x80;
    s.x[0] = load64(temp);
  } else {
    /* Padding when ciphertext is multiple of rate */
    s.x[0] ^= 0x8000000000000000ULL;
  }

  /* Finalization */
  s.x[1] ^= k0;
  s.x[2] ^= k1;
  ascon_permutation(&s, 12);
  s.x[3] ^= k0;
  s.x[4] ^= k1;

  /* Verify tag (constant-time comparison) */
  uint64_t t0 = load64(tag);
  uint64_t t1 = load64(tag + 8);
  uint64_t diff = (s.x[3] ^ t0) | (s.x[4] ^ t1);

  /* Zeroize plaintext on authentication failure */
  if (diff != 0) {
    memset(plaintext, 0, ct_len);
    return -1;
  }

  return 0;
}
