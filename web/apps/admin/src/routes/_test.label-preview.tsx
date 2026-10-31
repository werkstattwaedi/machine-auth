// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import {
  DEFAULT_LABEL_FORMAT,
  LABEL_FORMATS,
  type LabelFormatId,
} from "@/printer/label-formats"
import { useLabelBitmap } from "@/printer/use-label-bitmap"
import { LabelPreview } from "@/printer/label-preview"

interface LabelPreviewSearch {
  url: string
  name: string
  mass: string
  variant: string
  code: string
  format: LabelFormatId
}

function coerceFormat(value: unknown): LabelFormatId {
  return typeof value === "string" && value in LABEL_FORMATS
    ? (value as LabelFormatId)
    : DEFAULT_LABEL_FORMAT
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
    variant: String(search.variant ?? ""),
    code: String(search.code ?? ""),
    format: coerceFormat(search.format),
  }),
  component: LabelPreviewTestPage,
})

function LabelPreviewTestPage() {
  const { url, name, mass, variant, code, format } = Route.useSearch()
  const { bitmap, loading } = useLabelBitmap(
    url && name && code
      ? {
          url,
          name,
          mass: mass || undefined,
          variant: variant || undefined,
          code,
          format: LABEL_FORMATS[format],
        }
      : null,
    true,
  )
  return (
    <div style={{ padding: 16, background: "white" }}>
      <LabelPreview bitmap={bitmap} loading={loading} nativeSize />
    </div>
  )
}
