// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Release version of this web build (ADR-0045), e.g. "2026.10.3" — compiled
// in by viteBuildVersion() in scripts/deploy/build-version.ts, which also writes
// /version.json next to the app. "dev" where Vite didn't build it (tests).
export const BUILD_VERSION: string = import.meta.env.VITE_BUILD_VERSION ?? "dev"
