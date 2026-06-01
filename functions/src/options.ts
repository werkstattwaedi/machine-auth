// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { setGlobalOptions } from "firebase-functions/v2/options";

// Deploy every function to europe-west6 (Zurich) — the closest region to our
// Swiss users, which removes the transatlantic RTT that us-central1 added to
// every callable, trigger, and scheduled invocation (#211). Set globally so a
// single knob covers all functions instead of a per-function `region:` option.
//
// This module MUST be imported before any function is defined. firebase-functions
// computes each function's `__endpoint` eagerly when `onCall`/`onRequest`/
// `onSchedule` runs (it reads the global options at that moment), and index.ts's
// re-exported function modules evaluate before index.ts's own body. Importing
// this first (the very first statement in index.ts) guarantees the global region
// is set before those modules define their functions.
setGlobalOptions({ region: "europe-west6" });
