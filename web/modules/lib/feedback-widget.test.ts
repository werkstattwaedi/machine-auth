// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  isFeedbackAvailable,
  isFeedbackShortcut,
  openFeedback,
  shouldShowMarkerLauncher,
} from "./feedback-widget"

const key = (over: Partial<KeyboardEvent>) => ({
  key: "PrintScreen",
  code: "PrintScreen",
  ctrlKey: true,
  shiftKey: true,
  altKey: false,
  metaKey: false,
  ...over,
})

afterEach(() => {
  delete window.Marker
  delete window.__Marker
})

describe("shouldShowMarkerLauncher", () => {
  it("shows the launcher on a staging build", () => {
    expect(
      shouldShowMarkerLauncher({ projectId: "oww-maco-staging", dev: false }),
    ).toBe(true)
  })

  it("hides it on production", () => {
    expect(shouldShowMarkerLauncher({ projectId: "oww-maco", dev: false })).toBe(
      false,
    )
  })

  it("hides it on the dev server, even against staging", () => {
    expect(
      shouldShowMarkerLauncher({ projectId: "oww-maco-staging", dev: true }),
    ).toBe(false)
    expect(shouldShowMarkerLauncher({ projectId: "oww-maco", dev: true })).toBe(
      false,
    )
  })

  it("hides it when the project is unknown", () => {
    expect(shouldShowMarkerLauncher({ projectId: undefined, dev: false })).toBe(
      false,
    )
  })
})

describe("isFeedbackShortcut", () => {
  it("matches Ctrl+Shift+PrintScreen", () => {
    expect(isFeedbackShortcut(key({}))).toBe(true)
    // Some layouts only report the physical code.
    expect(isFeedbackShortcut(key({ key: "Unidentified" }))).toBe(true)
  })

  it("ignores other combinations", () => {
    expect(isFeedbackShortcut(key({ ctrlKey: false }))).toBe(false)
    expect(isFeedbackShortcut(key({ shiftKey: false }))).toBe(false)
    expect(isFeedbackShortcut(key({ altKey: true }))).toBe(false)
    expect(isFeedbackShortcut(key({ metaKey: true }))).toBe(false)
    expect(isFeedbackShortcut(key({ key: "p", code: "KeyP" }))).toBe(false)
  })
})

describe("openFeedback / isFeedbackAvailable", () => {
  it("is unavailable and a no-op without the widget", () => {
    expect(isFeedbackAvailable()).toBe(false)
    expect(() => openFeedback()).not.toThrow()
  })

  it("opens a fullscreen capture once the widget is installed", () => {
    const capture = vi.fn()
    window.__Marker = {}
    window.Marker = { capture }
    expect(isFeedbackAvailable()).toBe(true)
    openFeedback()
    expect(capture).toHaveBeenCalledWith("fullscreen")
  })
})
