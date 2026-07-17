// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { TAPE_SPECS, type TapeKey } from "@oww/shared"
import { useLabelBitmap } from "@/printer/use-label-bitmap"
import { LabelPreview } from "@/printer/label-preview"

interface LabelPreviewSearch {
  url: string
  name: string
  mass: string
  code: string
  tape: TapeKey
}

function coerceTape(value: unknown): TapeKey {
  return typeof value === "string" && value in TAPE_SPECS
    ? (value as TapeKey)
    : "18mm"
}

// Test-only deep link for the Playwright screenshot spec. Renders the
// label at native pixel size against a white background — no auth, no
// chrome, no scaling — so the screenshot is byte-for-byte the
// rasterised output. NOT linked from anywhere in the admin UI; URL
// reachable only by typing it in.
export const Route = createFileRoute("/_test/label-preview")({
  validateSearch: (search): LabelPreviewSearch => ({
    url: String(search.url ?? ""),
    name: String(search.name ?? ""),
    mass: String(search.mass ?? ""),
    code: String(search.code ?? ""),
    tape: coerceTape(search.tape),
  }),
  component: LabelPreviewTestPage,
})

function LabelPreviewTestPage() {
  const { url, name, mass, code, tape } = Route.useSearch()
  const { bitmap, loading } = useLabelBitmap(
    url && name && code
      ? { url, name, mass: mass || undefined, code, tape }
      : null,
    true,
  )
  return (
    <div style={{ padding: 16, background: "white" }}>
      <LabelPreview bitmap={bitmap} loading={loading} nativeSize />
    </div>
  )
}
