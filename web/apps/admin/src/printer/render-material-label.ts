// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import QRCode from "qrcode"
import { TAPE_SPECS, type TapeKey, type Bitmap1 } from "@oww/shared"

export type { TapeKey, Bitmap1 }

export interface MaterialLabelInput {
  /** Encoded into the QR code. */
  url: string
  /** Material name, e.g. "MDF roh 3mm". */
  title: string
  /** Material SKU prefix, e.g. "#6011". */
  code: string
  /** Tape width — currently 18 mm only in production. */
  tape: TapeKey
}

// Bitter is preloaded by the admin SPA via the Google Fonts `<link>` in
// index.html (weights 400, 500, 600, 700). Once Chromium has fetched
// it, `<canvas>` text in this family renders with Bitter glyphs at the
// printer's native 360 DPI. We use weight 700 (bold) for both lines so
// the heavy strokes survive the 1-bit threshold step.
const FONT_FAMILY = "Bitter, Georgia, serif"
const TITLE_WEIGHT = 700
const CODE_WEIGHT = 700

async function ensureFontsLoaded(titlePx: number, codePx: number) {
  if (typeof document === "undefined" || !document.fonts) return
  await document.fonts.load(`${TITLE_WEIGHT} ${titlePx}px Bitter`)
  await document.fonts.load(`${CODE_WEIGHT} ${codePx}px Bitter`)
  await document.fonts.ready
}

/**
 * Render a material label on an offscreen canvas at the printer's
 * native 360 DPI, threshold to 1-bit, and return a column-major
 * `Bitmap1` suitable for `buildRasterJob`.
 *
 * Layout: QR on the left (height-matched to the tape's print pins
 * minus a small inset), then a 2-column right region with `title` on
 * the upper line and `code` on the lower line. Width grows with the
 * content; the label cuts at whatever feed length covers the result.
 */
export async function renderMaterialLabel(
  input: MaterialLabelInput,
): Promise<Bitmap1> {
  const tape = TAPE_SPECS[input.tape]
  const height = tape.printPins

  // QR sizing: pick a module pixel size that leaves visible whitespace
  // around the QR so it's clearly centred on the label, not slammed
  // against the top + bottom edges. ~12 % vertical margin total (the
  // tape itself adds physical margin beyond the print area, but the
  // bitmap shouldn't pretend the print area edge is the QR edge).
  // QR version is picked by the qrcode library based on payload length;
  // ErrorCorrectionLevel "M" balances density and scannability.
  const qrMatrix = QRCode.create(input.url, { errorCorrectionLevel: "M" })
  const qrModules = qrMatrix.modules.size
  const verticalMarginTarget = Math.floor(height * 0.12)
  const qrAvailable = height - verticalMarginTarget * 2
  const modulePx = Math.max(2, Math.floor(qrAvailable / qrModules))
  const qrPx = modulePx * qrModules
  const qrTopInset = Math.floor((height - qrPx) / 2)
  // Mirror the vertical margin on the left so the QR doesn't kiss the
  // tape edge horizontally either.
  const qrLeftInset = qrTopInset

  // Text sizing: keep the title small enough that labels don't grow
  // longer than necessary (Mike's feedback). Code sits beneath in a
  // smaller block. Both at 360 DPI so 1 px = 1 dot.
  const titlePx = Math.floor(height * 0.42)
  const codePx = Math.floor(height * 0.28)
  const gap = Math.max(12, Math.floor(modulePx * 3))

  // Make sure Bitter is actually loaded before we measure — otherwise
  // measureText() uses the fallback metrics and the label width is
  // computed for a different font than the one we render with.
  await ensureFontsLoaded(titlePx, codePx)

  const scratch = new OffscreenCanvas(1, 1)
  const sctx = scratch.getContext("2d")
  if (!sctx) throw new Error("OffscreenCanvas 2D context unavailable")
  sctx.font = `${TITLE_WEIGHT} ${titlePx}px ${FONT_FAMILY}`
  const titleW = Math.ceil(sctx.measureText(input.title).width)
  sctx.font = `${CODE_WEIGHT} ${codePx}px ${FONT_FAMILY}`
  const codeW = Math.ceil(sctx.measureText(input.code).width)
  const textW = Math.max(titleW, codeW)

  // Final canvas dimensions. Add a small right margin so text doesn't
  // touch the auto-cut edge.
  const rightMargin = qrLeftInset
  const width = qrLeftInset + qrPx + gap + textW + rightMargin

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable")

  ctx.fillStyle = "white"
  ctx.fillRect(0, 0, width, height)

  // QR: draw each dark module as a module-sized fillRect. The QR is
  // offset by `qrLeftInset` so it has visible left margin too.
  // qrcode's matrix is row-major: `data[row * size + col]`.
  ctx.fillStyle = "black"
  for (let row = 0; row < qrModules; row++) {
    for (let col = 0; col < qrModules; col++) {
      if (qrMatrix.modules.get(row, col)) {
        ctx.fillRect(
          qrLeftInset + col * modulePx,
          qrTopInset + row * modulePx,
          modulePx,
          modulePx,
        )
      }
    }
  }

  // Text. The title top aligns with the QR top and the code bottom
  // aligns with the QR bottom, so the text block is visually framed by
  // the QR. `textBaseline = "alphabetic"` puts y at the baseline; we
  // approximate cap-height as ~0.72×titlePx (Bitter falls within that
  // band) to position title-top at qrTopInset.
  const textX = qrLeftInset + qrPx + gap
  ctx.textBaseline = "alphabetic"
  ctx.font = `${TITLE_WEIGHT} ${titlePx}px ${FONT_FAMILY}`
  const titleBaseline = qrTopInset + Math.round(titlePx * 0.78)
  ctx.fillText(input.title, textX, titleBaseline)
  ctx.font = `${CODE_WEIGHT} ${codePx}px ${FONT_FAMILY}`
  const codeBaseline = qrTopInset + qrPx - Math.round(codePx * 0.1)
  ctx.fillText(input.code, textX, codeBaseline)

  // Threshold to 1-bit, packed column-major MSB-first.
  const image = ctx.getImageData(0, 0, width, height)
  return imageDataToBitmap1(image, width, height)
}

function imageDataToBitmap1(
  image: ImageData,
  width: number,
  height: number,
): Bitmap1 {
  const bytesPerCol = Math.ceil(height / 8)
  const data = new Uint8Array(width * bytesPerCol)
  // Hard-threshold any pixel darker than mid-grey. The canvas is
  // black-on-white text + black QR; antialiasing produces grey edge
  // pixels which we want to bias toward ink for legibility at small
  // point sizes.
  const THRESHOLD = 160
  for (let col = 0; col < width; col++) {
    const colBase = col * bytesPerCol
    for (let row = 0; row < height; row++) {
      const i = (row * width + col) * 4
      // ImageData is RGBA; we wrote black/white, so any channel works.
      // Use luminance for safety against future colour additions.
      const lum = (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3
      if (lum < THRESHOLD) {
        data[colBase + (row >> 3)] |= 1 << (7 - (row & 7))
      }
    }
  }
  return { width, height, data }
}
