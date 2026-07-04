// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import "@testing-library/jest-dom/vitest"

// jsdom lacks ResizeObserver and elementFromPoint; input-otp (segmented code
// input) uses both to size/track its fake caret overlay. No-op stand-ins are
// enough — the tests interact with the underlying <input> directly.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
if (typeof document !== "undefined" && !document.elementFromPoint) {
  document.elementFromPoint = () => null
}
