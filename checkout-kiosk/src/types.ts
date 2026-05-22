// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Compile-time proof that the kiosk can resolve @oww/shared. Not loaded
// at runtime — main.js is plain JS. Issue #314 replaces this stub with
// the bridge protocol types once the bridge refactor lands.

export type { VariantPrice } from "@oww/shared"
