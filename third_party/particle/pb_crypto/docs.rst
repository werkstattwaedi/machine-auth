.. _module-pb_crypto:

=========
pb_crypto
=========
Platform-abstracted AES cryptographic operations for NTAG424 authentication.

This module provides AES-128-CBC and AES-CMAC operations with automatic
platform-specific backend selection.

-----
Platforms
-----
- **Particle P2**: Uses Device OS mbedTLS (potentially hardware accelerated)
- **Host simulator**: Uses mbedTLS directly

The backend is selected automatically based on the build target.

-----
Setup
-----
Add the dependency to your BUILD.bazel:

.. code-block:: python

   deps = [
       "@particle_bazel//pb_crypto:pb_crypto",
       "@pigweed//pw_status",
   ],

-----
Usage
-----

AES-CBC Encryption
==================
.. code-block:: cpp

   #include "pb_crypto/pb_crypto.h"

   std::array<std::byte, 16> key = {...};
   std::array<std::byte, 16> iv = {};  // Initialization vector
   std::array<std::byte, 32> plaintext = {...};
   std::array<std::byte, 32> ciphertext;

   pw::Status status = pb::crypto::AesCbcEncrypt(key, iv, plaintext, ciphertext);
   if (!status.ok()) {
     PW_LOG_ERROR("Encryption failed");
   }

AES-CBC Decryption
==================
.. code-block:: cpp

   std::array<std::byte, 32> decrypted;

   pw::Status status = pb::crypto::AesCbcDecrypt(key, iv, ciphertext, decrypted);

AES-CMAC
========
Compute a 16-byte message authentication code:

.. code-block:: cpp

   std::array<std::byte, 16> key = {...};
   std::vector<std::byte> message = {...};
   std::array<std::byte, 16> mac;

   pw::Status status = pb::crypto::AesCmac(key, message, mac);

-----
API Reference
-----
.. cpp:function:: pw::Status pb::crypto::AesCbcEncrypt(pw::ConstByteSpan key, pw::ConstByteSpan iv, pw::ConstByteSpan plaintext, pw::ByteSpan ciphertext)

   AES-128-CBC encryption.

   :param key: 16-byte AES key
   :param iv: 16-byte initialization vector (not modified)
   :param plaintext: Input data (must be multiple of 16 bytes)
   :param ciphertext: Output buffer (same size as plaintext)
   :returns: ``OkStatus()`` on success, ``InvalidArgument`` for wrong sizes,
             ``Internal`` for crypto errors

.. cpp:function:: pw::Status pb::crypto::AesCbcDecrypt(pw::ConstByteSpan key, pw::ConstByteSpan iv, pw::ConstByteSpan ciphertext, pw::ByteSpan plaintext)

   AES-128-CBC decryption.

   :param key: 16-byte AES key
   :param iv: 16-byte initialization vector (not modified)
   :param ciphertext: Input data (must be multiple of 16 bytes)
   :param plaintext: Output buffer (same size as ciphertext)
   :returns: ``OkStatus()`` on success, ``InvalidArgument`` for wrong sizes,
             ``Internal`` for crypto errors

.. cpp:function:: pw::Status pb::crypto::AesCmac(pw::ConstByteSpan key, pw::ConstByteSpan data, pw::ByteSpan mac)

   AES-CMAC (Cipher-based Message Authentication Code).

   :param key: 16-byte AES key
   :param data: Input data (any length)
   :param mac: Output MAC (must be at least 16 bytes)
   :returns: ``OkStatus()`` on success, ``InvalidArgument`` for wrong key size,
             ``ResourceExhausted`` if mac too small, ``Internal`` for crypto errors

-----
Constants
-----
.. cpp:var:: constexpr size_t pb::crypto::kAesBlockSize = 16

   AES block size in bytes (128 bits).

.. cpp:var:: constexpr size_t pb::crypto::kAesKeySize = 16

   AES-128 key size in bytes.

-----------------------
Implementation Details
-----------------------
Particle Backend (``pb_crypto_particle.cc``)
============================================
- Uses Device OS mbedTLS library
- May leverage hardware AES acceleration on RTL8721DM
- Accesses mbedTLS through Device OS headers

Host Backend (``pb_crypto_mbedtls.cc``)
=======================================
- Uses mbedTLS library directly
- Software-only implementation
- Used for host-side testing and simulation

Backend Selection
=================
The backend is selected via Bazel ``select()`` based on platform constraints:

.. code-block:: python

   alias(
       name = "pb_crypto_backend",
       actual = select({
           "@pigweed//pw_build/constraints/arm:cortex-m33": ":pb_crypto_particle_impl",
           "//conditions:default": ":pb_crypto_mbedtls_impl",
       }),
   )

----------
Bazel Targets
----------
- ``//pb_crypto:pb_crypto`` - Platform-abstracted crypto (use this)
- ``//pb_crypto:pb_crypto_particle_impl`` - Particle backend
- ``//pb_crypto:pb_crypto_mbedtls_impl`` - mbedTLS backend
