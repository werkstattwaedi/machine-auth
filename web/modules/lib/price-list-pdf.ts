// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { jsPDF } from "jspdf"
import type { PriceList, CatalogItem } from "./workshop-config"
import { getShortUnit } from "./workshop-config"

export function generatePriceListPdf(
  priceList: PriceList,
  catalogItems: CatalogItem[],
  qrDataUrl: string,
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const pageWidth = 210
  const margin = 20
  const contentWidth = pageWidth - 2 * margin
  let y = margin

  // Title
  doc.setFontSize(18)
  doc.text(priceList.name, margin, y)
  y += 12

  // Table header
  const colX = {
    code: margin,
    name: margin + 18,
    price: margin + contentWidth - 70,
    memberPrice: margin + contentWidth - 40,
    unit: margin + contentWidth - 10,
  }

  doc.setFontSize(9)
  doc.setFont("helvetica", "bold")
  doc.text("Code", colX.code, y)
  doc.text("Name", colX.name, y)
  doc.text("Preis", colX.price, y, { align: "right" })
  doc.text("Mitglieder", colX.memberPrice, y, { align: "right" })
  doc.text("Einheit", colX.unit, y, { align: "right" })
  y += 2
  doc.setLineWidth(0.3)
  doc.line(margin, y, margin + contentWidth, y)
  y += 5

  // Table rows
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)

  for (const item of catalogItems) {
    if (y > 260) {
      doc.addPage()
      y = margin
    }

    doc.text(item.code, colX.code, y)

    // Truncate long names to fit column
    const maxNameWidth = colX.price - colX.name - 5
    let name = item.name
    if (doc.getTextWidth(name) > maxNameWidth) {
      const ratio = maxNameWidth / doc.getTextWidth(name)
      const estLen = Math.floor(name.length * ratio) - 3
      name = name.slice(0, Math.max(1, estLen)) + "..."
    }
    doc.text(name, colX.name, y)

    const priceNone = item.unitPrice?.none ?? 0
    const priceMember = item.unitPrice?.member ?? 0
    doc.text(formatPrice(priceNone), colX.price, y, { align: "right" })
    doc.text(formatPrice(priceMember), colX.memberPrice, y, { align: "right" })
    doc.text(getShortUnit(item.pricingModel), colX.unit, y, { align: "right" })
    y += 6
  }

  // QR code + footer at bottom
  y = Math.max(y + 10, 240)
  if (y > 260) {
    doc.addPage()
    y = margin
  }

  // QR code
  const qrSize = 30
  doc.addImage(qrDataUrl, "PNG", margin, y, qrSize, qrSize)

  // Footer text next to QR
  if (priceList.footer) {
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(priceList.footer, margin + qrSize + 5, y + qrSize / 2, {
      baseline: "middle",
    })
    doc.setTextColor(0)
  }

  const safeName = priceList.name.replace(/[/\\:*?"<>|]/g, "_")
  doc.save(`${safeName}.pdf`)
}

function formatPrice(amount: number): string {
  return `CHF ${amount.toFixed(2)}`
}
