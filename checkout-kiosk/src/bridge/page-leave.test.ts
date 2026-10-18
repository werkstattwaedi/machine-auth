// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"

import { watchPageLeave, type PageEvents } from "./page-leave.ts"

function fakePage(): EventEmitter & PageEvents & { destroyed: boolean } {
  const page = new EventEmitter() as EventEmitter & PageEvents & { destroyed: boolean }
  page.destroyed = false
  page.isDestroyed = () => page.destroyed
  return page
}

test("a reload or a navigation to another document leaves the page", () => {
  const page = fakePage()
  let left = 0
  watchPageLeave(page, () => left++)
  page.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false })
  assert.equal(left, 1)
})

test("in-page route changes and subframes don't", () => {
  const page = fakePage()
  let left = 0
  watchPageLeave(page, () => left++)
  page.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true })
  page.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false })
  assert.equal(left, 0)
})

test("a crashed renderer or a destroyed page leaves it, once", () => {
  const page = fakePage()
  let left = 0
  watchPageLeave(page, () => left++)
  page.emit("render-process-gone")
  page.emit("destroyed")
  assert.equal(left, 1)
})

test("stopping removes every listener", () => {
  const page = fakePage()
  let left = 0
  const stop = watchPageLeave(page, () => left++)
  stop()
  page.emit("render-process-gone")
  page.emit("destroyed")
  page.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false })
  assert.equal(left, 0)
  assert.equal(page.listenerCount("did-start-navigation"), 0)
})
