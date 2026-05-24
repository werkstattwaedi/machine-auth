// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react"
import type { Bitmap1 } from "./render-material-label"

interface LabelPreviewProps {
  bitmap: Bitmap1 | null
  loading?: boolean
  /** Pixel height at which to display. The 1-bit bitmap is painted at
   *  its native resolution and CSS-scaled (pixelated) to this height.
   *  Ignored when `nativeSize` is true. */
  displayHeight?: number
  /** Bypass CSS scaling and render the canvas at the bitmap's native
   *  dimensions. Used by the screenshot test so the snapshot is byte-
   *  for-byte the rasterised output, no subpixel scaling artifacts. */
  nativeSize?: boolean
  className?: string
}

/**
 * WYSIWYG preview of the rasterised label. Paints the 1-bit bitmap onto
 * a `<canvas>` at native pixel size; CSS scales the canvas element to
 * `displayHeight` so a 234-pixel-tall (18 mm at 360 DPI) bitmap fits
 * inline next to the print button.
 */
export function LabelPreview({
  bitmap,
  loading,
  displayHeight = 72,
  nativeSize = false,
  className,
}: LabelPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // `painted` flips to true only after `putImageData` has actually run,
  // which is what the screenshot test needs to wait on — flipping a
  // ready flag in the render phase would race the paint effect.
  const [painted, setPainted] = useState(false)

  useEffect(() => {
    setPainted(false)
    const canvas = canvasRef.current
    if (!canvas || !bitmap) return
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const image = ctx.createImageData(bitmap.width, bitmap.height)
    const bytesPerCol = Math.ceil(bitmap.height / 8)
    for (let col = 0; col < bitmap.width; col++) {
      for (let row = 0; row < bitmap.height; row++) {
        const byte = bitmap.data[col * bytesPerCol + (row >> 3)]
        const bit = (byte >> (7 - (row & 7))) & 1
        const i = (row * bitmap.width + col) * 4
        const v = bit ? 0 : 255
        image.data[i] = v
        image.data[i + 1] = v
        image.data[i + 2] = v
        image.data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    setPainted(true)
  }, [bitmap])

  // Reserve the slot whether or not we have a bitmap yet so the layout
  // doesn't jump as the user edits the title/code.
  return (
    <div
      className={className}
      data-testid="label-preview"
      data-ready={painted && !loading ? "true" : "false"}
      style={
        nativeSize
          ? {
              display: "inline-block",
              background: "white",
              padding: 0,
              lineHeight: 0,
            }
          : {
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              height: displayHeight,
              padding: "4px",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              background: "white",
              opacity: loading ? 0.5 : 1,
            }
      }
    >
      {bitmap ? (
        <canvas
          ref={canvasRef}
          data-testid="label-preview-canvas"
          data-bitmap-width={bitmap.width}
          data-bitmap-height={bitmap.height}
          style={
            nativeSize
              ? { imageRendering: "pixelated" }
              : {
                  height: displayHeight - 10,
                  width: "auto",
                  imageRendering: "pixelated",
                  // Border traces the label's actual bounds (1 px at
                  // the bitmap's native resolution) so you can see how
                  // big the label will print, not just where the
                  // wrapper sits.
                  border: "1px solid hsl(var(--border))",
                  boxSizing: "content-box",
                }
          }
        />
      ) : (
        <span
          style={{
            fontSize: "0.75rem",
            color: "hsl(var(--muted-foreground))",
            padding: "0 0.5rem",
          }}
        >
          {loading ? "Vorschau wird gerendert…" : "Keine Vorschau"}
        </span>
      )}
    </div>
  )
}
