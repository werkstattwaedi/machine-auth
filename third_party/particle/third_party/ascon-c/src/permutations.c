/*
 * ASCON Permutation Implementation
 * Reference implementation based on the ASCON specification
 *
 * SPDX-License-Identifier: CC0-1.0
 */

#include "ascon.h"

/* Round constants for ASCON-p */
static const uint64_t kRoundConstants[12] = {
    0x00000000000000f0ULL, 0x00000000000000e1ULL, 0x00000000000000d2ULL,
    0x00000000000000c3ULL, 0x00000000000000b4ULL, 0x00000000000000a5ULL,
    0x0000000000000096ULL, 0x0000000000000087ULL, 0x0000000000000078ULL,
    0x0000000000000069ULL, 0x000000000000005aULL, 0x000000000000004bULL,
};

/* 64-bit rotate right */
static inline uint64_t rotr64(uint64_t x, int n) {
  return (x >> n) | (x << (64 - n));
}

/* ASCON S-box layer */
static void ascon_sbox(ascon_state_t* s) {
  uint64_t t0, t1, t2, t3, t4;

  s->x[0] ^= s->x[4];
  s->x[4] ^= s->x[3];
  s->x[2] ^= s->x[1];

  t0 = s->x[0] ^ (~s->x[1] & s->x[2]);
  t1 = s->x[1] ^ (~s->x[2] & s->x[3]);
  t2 = s->x[2] ^ (~s->x[3] & s->x[4]);
  t3 = s->x[3] ^ (~s->x[4] & s->x[0]);
  t4 = s->x[4] ^ (~s->x[0] & s->x[1]);

  t1 ^= t0;
  t0 ^= t4;
  t3 ^= t2;
  t2 = ~t2;

  s->x[0] = t0;
  s->x[1] = t1;
  s->x[2] = t2;
  s->x[3] = t3;
  s->x[4] = t4;
}

/* ASCON linear diffusion layer */
static void ascon_linear(ascon_state_t* s) {
  s->x[0] ^= rotr64(s->x[0], 19) ^ rotr64(s->x[0], 28);
  s->x[1] ^= rotr64(s->x[1], 61) ^ rotr64(s->x[1], 39);
  s->x[2] ^= rotr64(s->x[2], 1) ^ rotr64(s->x[2], 6);
  s->x[3] ^= rotr64(s->x[3], 10) ^ rotr64(s->x[3], 17);
  s->x[4] ^= rotr64(s->x[4], 7) ^ rotr64(s->x[4], 41);
}

/* ASCON permutation with specified number of rounds */
void ascon_permutation(ascon_state_t* state, int rounds) {
  int start = 12 - rounds;
  for (int i = start; i < 12; i++) {
    /* Add round constant */
    state->x[2] ^= kRoundConstants[i];
    /* S-box layer */
    ascon_sbox(state);
    /* Linear diffusion layer */
    ascon_linear(state);
  }
}
