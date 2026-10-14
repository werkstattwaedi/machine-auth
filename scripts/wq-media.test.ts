// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Locks the layout contract between scripts/wq-capture.sh output and the
// markdown the workqueue posts: a screen that is missing on one side must
// show "—", never shift the other side's image into the wrong column.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { listCaptures, renderMarkdown, type Capture } from "./wq-media.ts"

const url = (rel: string) => `https://x/${rel}`

function cap(phase: Capture["phase"], project: string, name: string): Capture {
  return { phase, project, name, rel: `${phase}/${project}/${name}.png` }
}

test("lists before/after captures and ignores files outside the layout", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wq-media-"))
  for (const p of ["before/desktop", "after/desktop", "after/mobile", "stray"]) {
    mkdirSync(path.join(dir, p), { recursive: true })
  }
  writeFileSync(path.join(dir, "before/desktop/01-start.png"), "")
  writeFileSync(path.join(dir, "after/desktop/01-start.png"), "")
  writeFileSync(path.join(dir, "after/mobile/01-start.png"), "")
  writeFileSync(path.join(dir, "after/mobile/notes.txt"), "")
  writeFileSync(path.join(dir, "stray/x.png"), "")

  const rels = listCaptures(dir).map((c) => c.rel).sort()
  assert.deepEqual(rels, [
    "after/desktop/01-start.png",
    "after/mobile/01-start.png",
    "before/desktop/01-start.png",
  ])
})

test("a screen missing before (new UI) gets a dash in the before column", () => {
  const md = renderMarkdown(
    [cap("before", "desktop", "01-start"), cap("after", "desktop", "01-start"), cap("after", "desktop", "02-new")],
    url,
  )
  assert.match(md, /\| `02-new` \| — \| <img src="https:\/\/x\/after\/desktop\/02-new.png"/)
  assert.match(md, /\| Screen \| Vorher \| Nachher \|/)
})

test("after-only captures render without a before column", () => {
  const md = renderMarkdown([cap("after", "mobile", "01-start")], url)
  assert.match(md, /\| Screen \| Nachher \|/)
  assert.doesNotMatch(md, /Vorher/)
  assert.match(md, /width="260"/)
})

test("desktop comes before mobile; steps sort numerically", () => {
  const md = renderMarkdown(
    [cap("after", "mobile", "2-b"), cap("after", "desktop", "10-c"), cap("after", "desktop", "2-b")],
    url,
  )
  assert.ok(md.indexOf("**Desktop**") < md.indexOf("**Mobil**"))
  assert.ok(md.indexOf("`2-b`") < md.indexOf("`10-c`"))
  assert.ok(md.startsWith("<!-- claude-workqueue-media -->"))
})
