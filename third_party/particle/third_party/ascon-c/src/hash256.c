/*
 * ASCON-Hash256 Implementation
 * 256-bit cryptographic hash function
 *
 * SPDX-License-Identifier: CC0-1.0
 */

#include "ascon.h"

#include <string.h>

/* ASCON-Hash rate (8 bytes) */
#define RATE 8

/* Initialization vector for ASCON-Hash256 */
#define IV_HASH 0x00400c0000000100ULL

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

int ascon_hash256(uint8_t hash[ASCON_HASH256_BYTES],
                  const uint8_t* message,
                  size_t msg_len) {
  ascon_state_t s;

  /* Initialization */
  s.x[0] = IV_HASH;
  s.x[1] = 0;
  s.x[2] = 0;
  s.x[3] = 0;
  s.x[4] = 0;

  ascon_permutation(&s, 12);

  /* Absorb message */
  size_t i = 0;
  /* Full blocks */
  while (i + RATE <= msg_len) {
    s.x[0] ^= load64(message + i);
    ascon_permutation(&s, 12);
    i += RATE;
  }

  /* Partial block + padding */
  if (i < msg_len) {
    xor_bytes(&s.x[0], message + i, msg_len - i);
  }
  /* Padding: 10* pattern */
  {
    uint8_t temp[8] = {0};
    temp[msg_len % RATE] = 0x80;
    xor_bytes(&s.x[0], temp, RATE);
  }
  ascon_permutation(&s, 12);

  /* Squeeze output */
  store64(hash, s.x[0]);
  ascon_permutation(&s, 12);
  store64(hash + 8, s.x[0]);
  ascon_permutation(&s, 12);
  store64(hash + 16, s.x[0]);
  ascon_permutation(&s, 12);
  store64(hash + 24, s.x[0]);

  return 0;
}
