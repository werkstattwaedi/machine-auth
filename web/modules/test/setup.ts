// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { afterAll } from "vitest"
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

// input-otp@1.4.2 schedules setTimeout(0/10/50ms) from a mount effect and
// never clears them (only its password-manager-badge timers get cleaned up).
// If a straggler fires *after* Vitest tears down the jsdom `window` at
// end-of-file, its setState reaches React's scheduler, which reads `window`
// to resolve update priority → an unhandled "window is not defined" that
// fails the whole file even though every test passed. Draining pending
// macrotasks once per file (window still alive, components already unmounted
// by cleanup) lets those timers fire harmlessly before teardown. Runs once
// per test file, so the cost is negligible. Remove once input-otp ships the
// missing effect cleanup.
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 55))
})
