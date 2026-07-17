// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import {
  renderMaterialLabel,
  type Bitmap1,
  type MaterialLabelInput,
} from "./render-material-label"

interface UseLabelBitmapResult {
  bitmap: Bitmap1 | null
  loading: boolean
  error: string | null
}

/**
 * Render the material label off-screen and expose the resulting 1-bit
 * bitmap. The preview component paints this onto a visible canvas; the
 * print button feeds the same bitmap into `buildRasterJob`, so what's
 * on screen is exactly what would print.
 *
 * Re-runs whenever any field of `input` changes (shallow). Skipped when
 * `enabled` is false (e.g. the bridge isn't available — no point
 * rendering a preview the user can't print).
 */
export function useLabelBitmap(
  input: MaterialLabelInput | null,
  enabled = true,
): UseLabelBitmapResult {
  const [bitmap, setBitmap] = useState<Bitmap1 | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputKey = input
    ? `${input.url}|${input.name}|${input.mass ?? ""}|${input.code}|${input.tape}`
    : null

  useEffect(() => {
    if (!enabled || !input) {
      setBitmap(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    renderMaterialLabel(input)
      .then((bmp) => {
        if (cancelled) return
        setBitmap(bmp)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setBitmap(null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // We key the effect on a derived string so React re-runs only when
    // a meaningful input field actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, enabled])

  return { bitmap, loading, error }
}
