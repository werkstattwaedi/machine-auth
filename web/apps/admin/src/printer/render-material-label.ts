// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import QRCode from "qrcode"
import { TAPE_SPECS, type TapeKey, type Bitmap1 } from "@oww/shared"

export type { TapeKey, Bitmap1 }

export interface MaterialLabelInput {
  /** Encoded into the QR code. */
  url: string
  /** Line 1 — curated `Etikett Name`, e.g. "MDF". */
  name: string
  /** Line 2 — curated `Etikett Mass`, e.g. "3 mm". Line omitted when absent. */
  mass?: string
  /** `#` + 4-digit code, e.g. "#3160". Rendered vertically beside the QR. */
  code: string
  /** Tape width — currently 18 mm only in production. */
  tape: TapeKey
}

// Layout per the "Material label design system" handoff (Stufenlängen
// S/M/L, option 1c — code vertical right of the QR). The spec gives all
// dimensions in print pixels at 300 dpi on a 212 px (18 mm) canvas; the
// P950 prints 234 pins on 18 mm tape (16.5 mm printable window), so we
// apply the spec's own scaling rule — content dimensions scale by
// printPins/212. Label lengths stay physically 48/72/96 mm so labels on
// a shelf line up in exactly three flush lengths.
const SPEC_CANVAS_PX = 212
const DPI = 360
const STEP_LENGTHS_MM = [48, 72, 96]

const BITTER = "Bitter, Georgia, serif"
const ROBOTO_SLAB = '"Roboto Slab", Georgia, serif'
const NAME_WEIGHT = 800 // Bitter ExtraBold
const MASS_WEIGHT = 600 // Bitter SemiBold
const CODE_WEIGHT = 500 // Roboto Slab Medium
const CODE_TRACKING_EM = 0.05

async function ensureFontsLoaded() {
  if (typeof document === "undefined" || !document.fonts) return
  await document.fonts.load(`${NAME_WEIGHT} 65px Bitter`)
  await document.fonts.load(`${MASS_WEIGHT} 44px Bitter`)
  await document.fonts.load(`${CODE_WEIGHT} 50px "Roboto Slab"`)
  await document.fonts.ready
}

type Ctx2d = OffscreenCanvasRenderingContext2D

// letterSpacing landed in Chromium 99; engines without it just render
// the code column with slightly tighter tracking.
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
 * native 360 DPI, threshold to 1-bit, and return a column-major
 * `Bitmap1` suitable for `buildRasterJob`.
 *
 * Layout, left to right: QR code (vertically centred), the `#code`
 * rotated 90° reading bottom-up and height-matched to the QR, then the
 * text block — name on top, mass below (or the name alone, vertically
 * centred). The label length snaps to the smallest S/M/L step that fits;
 * only the name font may shrink (never mass or code) when even L is too
 * short.
 */
export async function renderMaterialLabel(
  input: MaterialLabelInput,
): Promise<Bitmap1> {
  const tape = TAPE_SPECS[input.tape]
  const height = tape.printPins
  const s = height / SPEC_CANVAS_PX
  const px = (specPx: number) => Math.round(specPx * s)

  const mass = input.mass?.trim() || null

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

  const leftMargin = px(18)
  const gapQrCode = px(12)
  const gapCodeText = px(21)
  const rightMargin = px(24)
  const nameBasePx = px(65)
  const nameMinPx = px(35)
  const nameStepPx = Math.max(1, px(3))
  const massPx = px(44)
  const nameMassGap = px(7)

  // Make sure the label fonts are actually loaded before we measure —
  // otherwise measureText() uses fallback metrics and the label width is
  // computed for a different font than the one we render with.
  await ensureFontsLoaded()

  const sctx = context2d(new OffscreenCanvas(1, 1))

  // Code font size: the rotated run must fill the QR height exactly,
  // letter-spacing included. Measure at a reference size, scale linearly.
  const REF = 100
  sctx.font = `${CODE_WEIGHT} ${REF}px ${ROBOTO_SLAB}`
  setLetterSpacing(sctx, CODE_TRACKING_EM * REF)
  const codeRefW = sctx.measureText(input.code).width
  const codePx = Math.max(8, Math.floor((REF * qrPx) / codeRefW))
  sctx.font = `${CODE_WEIGHT} ${codePx}px ${ROBOTO_SLAB}`
  setLetterSpacing(sctx, CODE_TRACKING_EM * codePx)
  const codeMetrics = sctx.measureText(input.code)
  const codeRun = codeMetrics.width
  const codeColW = Math.ceil(
    codeMetrics.actualBoundingBoxAscent + codeMetrics.actualBoundingBoxDescent,
  )
  setLetterSpacing(sctx, 0)

  // Length steps + name shrink: pick the smallest step whose length fits
  // the natural width. If the name alone overflows even L, shrink it (in
  // spec steps, to the spec minimum); mass and code never shrink.
  const stepWidths = STEP_LENGTHS_MM.map((mm) => Math.round((mm * DPI) / 25.4))
  const fixedLeft = leftMargin + qrPx + gapQrCode + codeColW + gapCodeText
  const maxTextW = stepWidths[stepWidths.length - 1] - fixedLeft - rightMargin

  const measureName = (sizePx: number) => {
    sctx.font = `${NAME_WEIGHT} ${sizePx}px ${BITTER}`
    return sctx.measureText(input.name)
  }
  let namePx = nameBasePx
  let nameMetrics = measureName(namePx)
  while (nameMetrics.width > maxTextW && namePx - nameStepPx >= nameMinPx) {
    namePx -= nameStepPx
    nameMetrics = measureName(namePx)
  }

  sctx.font = `${MASS_WEIGHT} ${massPx}px ${BITTER}`
  const massMetrics = mass ? sctx.measureText(mass) : null

  const textW = Math.ceil(Math.max(nameMetrics.width, massMetrics?.width ?? 0))
  const natural = fixedLeft + textW + rightMargin
  // A name still overflowing L at minimum size extends the label instead
  // of clipping — unreachable with the current catalog, but never cut ink.
  const width = stepWidths.find((w) => w >= natural) ?? natural

  const canvas = new OffscreenCanvas(width, height)
  const ctx = context2d(canvas)

  ctx.fillStyle = "white"
  ctx.fillRect(0, 0, width, height)

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

  // Code column: rotated -90° so it reads bottom-up, ink centred on the
  // QR. After rotation the glyph ascent extends left of the anchor, so
  // the anchor sits `ascent` right of the column's left edge.
  const codeX = leftMargin + qrPx + gapQrCode
  ctx.save()
  ctx.font = `${CODE_WEIGHT} ${codePx}px ${ROBOTO_SLAB}`
  setLetterSpacing(ctx, CODE_TRACKING_EM * codePx)
  ctx.translate(
    codeX + codeMetrics.actualBoundingBoxAscent,
    qrTop + qrPx - (qrPx - codeRun) / 2,
  )
  ctx.rotate(-Math.PI / 2)
  ctx.fillText(input.code, 0, 0)
  ctx.restore()

  // Text block: name + mass stacked with a fixed ink gap, the whole
  // block optically centred; without mass the name centres alone (the
  // spec's "kein Loch unten").
  const textX = codeX + codeColW + gapCodeText
  const nameA = nameMetrics.actualBoundingBoxAscent
  const nameD = nameMetrics.actualBoundingBoxDescent
  ctx.font = `${NAME_WEIGHT} ${namePx}px ${BITTER}`
  if (mass && massMetrics) {
    const massA = massMetrics.actualBoundingBoxAscent
    const massD = massMetrics.actualBoundingBoxDescent
    const block = nameA + nameD + nameMassGap + massA + massD
    const top = (height - block) / 2
    ctx.fillText(input.name, textX, Math.round(top + nameA))
    ctx.font = `${MASS_WEIGHT} ${massPx}px ${BITTER}`
    ctx.fillText(mass, textX, Math.round(top + nameA + nameD + nameMassGap + massA))
  } else {
    ctx.fillText(input.name, textX, Math.round((height + nameA - nameD) / 2))
  }

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
