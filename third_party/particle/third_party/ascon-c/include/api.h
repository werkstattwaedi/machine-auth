/*
 * ASCON API definitions
 * Based on NIST Lightweight Cryptography standard
 * Reference: https://ascon.iaik.tugraz.at/
 *
 * SPDX-License-Identifier: CC0-1.0
 */

#ifndef ASCON_API_H
#define ASCON_API_H

/* ASCON-AEAD128 parameters */
#define ASCON_AEAD128_KEY_BYTES 16
#define ASCON_AEAD128_NONCE_BYTES 16
#define ASCON_AEAD128_TAG_BYTES 16

/* ASCON-Hash256 parameters */
#define ASCON_HASH256_BYTES 32

/* ASCON-XOF parameters */
#define ASCON_XOF_RATE 8

#endif /* ASCON_API_H */
