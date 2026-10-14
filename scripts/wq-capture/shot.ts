// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Screenshot helper for workqueue review captures (`*.capture.ts` specs).
// The worker writes a throwaway capture spec, runs it once before and once
// after its change (scripts/wq-capture.sh), and posts both sets to the issue
// so a reviewer sees the UI change without checking out the branch.

import path from "node:path"
import { test, type Page } from "@playwright/test"

/**
 * Saves the current viewport as `<WQ_CAPTURE_OUT>/<project>/<name>.png`.
 * Prefix names with a step number ("01-tap", "02-offer") so a flow reads
 * as a storyboard in order.
 */
export async function shot(
  page: Page,
  name: string,
  opts: { fullPage?: boolean } = {},
): Promise<void> {
  const out = process.env.WQ_CAPTURE_OUT
  if (!out) throw new Error("WQ_CAPTURE_OUT is not set — run via scripts/wq-capture.sh")
  await page.screenshot({
    path: path.join(out, test.info().project.name, `${name}.png`),
    fullPage: opts.fullPage ?? false,
    animations: "disabled",
    caret: "hide",
  })
}
