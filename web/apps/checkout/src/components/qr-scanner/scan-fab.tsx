// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState } from "react"
import { ScanLine } from "lucide-react"
import { QrScannerSheet } from "./qr-scanner-sheet"
import { useCanScanQr } from "./use-can-scan-qr"

/**
 * Floating action button that opens the in-app QR scanner. Sits anchored
 * to the bottom-right of the viewport so it remains thumb-reachable on
 * mobile. Rendered only on touch-primary devices with a camera; otherwise
 * returns `null` (see [[use-can-scan-qr]] for why this isn't gated by
 * `useIsMobile()`).
 */
export function ScanFab() {
  const canScan = useCanScanQr()
  const [open, setOpen] = useState(false)
  if (!canScan) return null
  return (
    <>
      <button
        type="button"
        aria-label="QR-Code scannen"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-cog-teal text-white shadow-lg shadow-black/20 hover:bg-cog-teal-dark active:scale-95 transition"
      >
        <ScanLine className="h-6 w-6" />
      </button>
      <QrScannerSheet open={open} onOpenChange={setOpen} />
    </>
  )
}
