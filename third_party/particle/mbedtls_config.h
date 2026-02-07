// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Minimal mbedtls configuration for embedded (P2/RTL872x).
// Only includes AES-CBC and AES-CMAC needed for NTAG424 authentication.
//
// Based on Device OS configuration but stripped down to essentials.

#ifndef MBEDTLS_CONFIG_H
#define MBEDTLS_CONFIG_H

// =============================================================================
// System Support
// =============================================================================

// No platform entropy - we provide our own RNG via HAL_RNG_GetRandomNumber
#define MBEDTLS_NO_PLATFORM_ENTROPY
#define MBEDTLS_NO_DEFAULT_ENTROPY_SOURCES

// Use ROM tables for smaller code size
#define MBEDTLS_AES_ROM_TABLES

// No file I/O
#define MBEDTLS_NO_FILE_IO

// No standard library dependencies we can't provide
#define MBEDTLS_PLATFORM_NO_STD_FUNCTIONS

// =============================================================================
// Cipher Configuration
// =============================================================================

// AES core
#define MBEDTLS_AES_C

// CBC mode for AES-CBC encryption/decryption
#define MBEDTLS_CIPHER_MODE_CBC

// CMAC for AES-CMAC (message authentication codes)
#define MBEDTLS_CMAC_C

// Cipher abstraction layer (required for CMAC)
#define MBEDTLS_CIPHER_C

// =============================================================================
// Disabled Features
// =============================================================================

// We don't need entropy/DRBG - we use HAL_RNG directly
// #define MBEDTLS_ENTROPY_C
// #define MBEDTLS_CTR_DRBG_C

// We don't need hashing (NTAG424 uses CMAC not HMAC)
// #define MBEDTLS_SHA256_C
// #define MBEDTLS_MD_C

// We don't need public key crypto
// #define MBEDTLS_RSA_C
// #define MBEDTLS_ECP_C
// #define MBEDTLS_ECDSA_C

// We don't need TLS
// #define MBEDTLS_SSL_CLI_C
// #define MBEDTLS_SSL_SRV_C

// We don't need X.509
// #define MBEDTLS_X509_CRT_PARSE_C

// =============================================================================
// Platform Abstraction
// =============================================================================

// Use standard C library functions where available
#include <stdlib.h>
#include <string.h>

// Memory allocation - use standard malloc/free
#define MBEDTLS_PLATFORM_C
#define MBEDTLS_PLATFORM_MEMORY
#define mbedtls_calloc    calloc
#define mbedtls_free      free

// Prevent use of deprecated functions
#define MBEDTLS_DEPRECATED_REMOVED

#endif // MBEDTLS_CONFIG_H
