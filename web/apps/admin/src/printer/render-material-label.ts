// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import QRCode from "qrcode"
import { TAPE_SPECS, type TapeKey, type Bitmap1 } from "@oww/shared"

export type { TapeKey, Bitmap1 }

export interface MaterialLabelInput {
  /** Encoded into the QR code. */
  url: string
  /** Line 2 — curated `Etikett Name`, e.g. "MDF". Big, vertically centred. */
  name: string
  /** Line 3 — curated `Etikett Mass`, e.g. "3 mm". Line omitted when absent. */
  mass?: string
  /** Line 1 — `#` + 4-digit code, e.g. "#3160". Small, top of the text block. */
  code: string
  /** Tape width — currently 18 mm only in production. */
  tape: TapeKey
  /** Uniform label length in mm (spec "Einheitslänge"). Default 72. */
  widthMm?: number
}

// Layout per the "Material label design system" handoff, option 2a
// ("dreizeilig mit Einheitslänge"): QR left, then a three-line text
// block — code small on top, name big and centred on the QR's middle,
// mass small at the bottom. Every label is the same length so they sit
// flush on the shelf.
//
// The spec gives all dimensions in print pixels on a 212 px (18 mm)
// canvas at 300 dpi. The P950 prints 234 pins on 18 mm tape (a ~16.5 mm
// printable window), so we apply the spec's own scaling rule — scale
// every dimension by printPins/212, keeping pixels square, the QR
// square, and the whole 18 mm design proportionally mapped onto the
// printable window.
const SPEC_CANVAS_PX = 212
const DEFAULT_LABEL_WIDTH_MM = 72
// The head's native feed-axis resolution. Unlike the tape-width (pin)
// axis, the feed axis has no printable-window limit, so label length is
// computed at true DPI — not through the `px()` squeeze.
const DPI = 360

/**
 * Physical label length in printer dots. The feed axis prints at the
 * head's true 360 DPI, independent of the vertical `px()` scaling that
 * compresses the 18 mm design into the ~16.5 mm printable window — so a
 * 72 mm label actually prints 72 mm long (and all labels stay flush on
 * the shelf). Exported for a unit test that guards this against the
 * double-scaling regression the screenshot test can't catch on its own.
 */
export function labelWidthDots(widthMm: number): number {
  return Math.round((widthMm * DPI) / 25.4)
}

const BITTER = "Bitter, Georgia, serif"
const ROBOTO_SLAB = '"Roboto Slab", Georgia, serif'
const NAME_WEIGHT = 800 // Bitter ExtraBold
const MASS_WEIGHT = 600 // Bitter SemiBold
const CODE_WEIGHT = 500 // Roboto Slab Medium
const CODE_TRACKING_EM = 0.08

async function ensureFontsLoaded() {
  if (typeof document === "undefined" || !document.fonts) return
  await document.fonts.load(`${NAME_WEIGHT} 65px Bitter`)
  await document.fonts.load(`${MASS_WEIGHT} 51px Bitter`)
  await document.fonts.load(`${CODE_WEIGHT} 51px "Roboto Slab"`)
  await document.fonts.ready
}

type Ctx2d = OffscreenCanvasRenderingContext2D

// letterSpacing landed in Chromium 99; engines without it just render
// the code with slightly tighter tracking.
function setLetterSpacing(ctx: Ctx2d, pxValue: number) {
  const c = ctx as { letterSpacing?: string }
  if ("letterSpacing" in ctx) c.letterSpacing = `${pxValue}px`
}

function context2d(canvas: OffscreenCanvas): Ctx2d {
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable")
  return ctx
}

/**
 * Render a material label on an offscreen canvas at the printer's
 * native resolution, threshold to 1-bit, and return a column-major
 * `Bitmap1` suitable for `buildRasterJob`.
 *
 * Layout, left to right: QR code (vertically centred), then a text
 * block spanning the QR's height — `#code` flush with the QR top, the
 * name big and centred on the QR's vertical middle, and the mass (when
 * present) flush with the QR bottom. Every label is the same fixed
 * length; only the name font shrinks (never code or mass) when a long
 * name would otherwise overflow.
 */
export async function renderMaterialLabel(
  input: MaterialLabelInput,
): Promise<Bitmap1> {
  const tape = TAPE_SPECS[input.tape]
  const height = tape.printPins
  const s = height / SPEC_CANVAS_PX
  const px = (specPx: number) => Math.round(specPx * s)

  const mass = input.mass?.trim() || null
  const widthMm = input.widthMm ?? DEFAULT_LABEL_WIDTH_MM

  // QR sizing: integer module size nearest the spec's 15 mm target —
  // integer modules keep edges crisp through the 1-bit threshold step.
  // QR version is picked by the qrcode library based on payload length;
  // ErrorCorrectionLevel "M" balances density and scannability.
  const qrMatrix = QRCode.create(input.url, { errorCorrectionLevel: "M" })
  const qrModules = qrMatrix.modules.size
  const qrTarget = px(177)
  let modulePx = Math.max(2, Math.round(qrTarget / qrModules))
  while (modulePx > 2 && modulePx * qrModules > height - px(8)) modulePx--
  const qrPx = modulePx * qrModules
  const qrTop = Math.round((height - qrPx) / 2)
  const qrBottom = qrTop + qrPx

  const leftMargin = px(18)
  const gapQrText = px(21)
  const rightMargin = px(24)
  const nameBasePx = px(59)
  const nameMinPx = px(35)
  const nameStepPx = Math.max(1, px(3))
  // Code + mass a touch larger than the original spec's 38 px so the
  // small lines stay legible on tape (feedback from the first prints).
  const codePx = px(46)
  const massPx = px(46)

  // Uniform label length (spec "Einheitslänge"): fixed regardless of
  // content so labels line up flush on the shelf.
  const width = labelWidthDots(widthMm)

  // Make sure the label fonts are actually loaded before we measure —
  // otherwise measureText() uses fallback metrics and the layout is
  // computed for a different font than the one we render with.
  await ensureFontsLoaded()

  const sctx = context2d(new OffscreenCanvas(1, 1))

  // Text block: left-aligned column right of the QR, up to the right
  // margin. The name shrinks (spec steps, spec minimum) if it would
  // overflow this width; code and mass never shrink.
  const textX = leftMargin + qrPx + gapQrText
  const availName = width - rightMargin - textX

  const measureName = (sizePx: number) => {
    sctx.font = `${NAME_WEIGHT} ${sizePx}px ${BITTER}`
    return sctx.measureText(input.name)
  }
  let namePx = nameBasePx
  let nameMetrics = measureName(namePx)
  while (nameMetrics.width > availName && namePx - nameStepPx >= nameMinPx) {
    namePx -= nameStepPx
    nameMetrics = measureName(namePx)
  }

  // A name still overflowing at the minimum size extends the label
  // instead of clipping ink — unreachable with the current catalog at
  // 72 mm, but never cut ink even if it happens.
  const overflow =
    nameMetrics.width > availName
      ? Math.ceil(nameMetrics.width - availName)
      : 0
  const finalWidth = width + overflow

  const canvas = new OffscreenCanvas(finalWidth, height)
  const ctx = context2d(canvas)

  ctx.fillStyle = "white"
  ctx.fillRect(0, 0, finalWidth, height)

  // QR: each dark module as a module-sized fillRect at integer coords.
  // qrcode's matrix is row-major: `modules.get(row, col)`.
  ctx.fillStyle = "black"
  for (let row = 0; row < qrModules; row++) {
    for (let col = 0; col < qrModules; col++) {
      if (qrMatrix.modules.get(row, col)) {
        ctx.fillRect(
          leftMargin + col * modulePx,
          qrTop + row * modulePx,
          modulePx,
          modulePx,
        )
      }
    }
  }

  ctx.textBaseline = "alphabetic"

  // Line 1 — code: Roboto Slab, tracked, top edge flush with the QR top.
  ctx.font = `${CODE_WEIGHT} ${codePx}px ${ROBOTO_SLAB}`
  setLetterSpacing(ctx, CODE_TRACKING_EM * codePx)
  const codeMetrics = ctx.measureText(input.code)
  ctx.fillText(input.code, textX, qrTop + codeMetrics.actualBoundingBoxAscent)
  setLetterSpacing(ctx, 0)

  // Line 2 — name: Bitter ExtraBold, always centred on the QR's vertical
  // middle, whether or not a mass line exists (spec "kein Loch unten").
  ctx.font = `${NAME_WEIGHT} ${namePx}px ${BITTER}`
  const nameA = nameMetrics.actualBoundingBoxAscent
  const nameD = nameMetrics.actualBoundingBoxDescent
  const qrMid = qrTop + qrPx / 2
  ctx.fillText(input.name, textX, Math.round(qrMid + (nameA - nameD) / 2))

  // Line 3 — mass (optional): Bitter SemiBold, bottom edge flush with
  // the QR bottom.
  if (mass) {
    ctx.font = `${MASS_WEIGHT} ${massPx}px ${BITTER}`
    const massMetrics = ctx.measureText(mass)
    ctx.fillText(mass, textX, qrBottom - massMetrics.actualBoundingBoxDescent)
  }

  // Threshold to 1-bit, packed column-major MSB-first.
  const image = ctx.getImageData(0, 0, finalWidth, height)
  return imageDataToBitmap1(image, finalWidth, height)
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
