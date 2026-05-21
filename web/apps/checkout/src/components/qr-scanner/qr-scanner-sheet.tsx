// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import { Camera, X } from "lucide-react"
import { toast } from "sonner"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@modules/components/ui/sheet"
import { VisuallyHidden } from "radix-ui"
import { parseCheckoutQr } from "@/lib/parse-checkout-qr"
import { useScanNavigation } from "./use-scan-navigation"

interface QrScannerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ScannerError = "permission" | "no-camera" | "generic"

/**
 * Full-viewport sheet that streams the rear camera, decodes QR codes
 * via the `qr-scanner` library, and dispatches valid `/visit/add/*`
 * deep links through `useScanNavigation`. Invalid QRs raise a toast
 * and scanning continues so the member can re-aim.
 *
 * The lib is loaded via dynamic `import()` so the ~50 KB decoder only
 * lands in the bundle when a member actually opens the scanner.
 */
export function QrScannerSheet({ open, onOpenChange }: QrScannerSheetProps) {
  // Track the video element via a state-backed callback ref so the
  // effect re-runs once the portaled `<video>` is actually mounted.
  // A plain `useRef` doesn't trigger a re-render when populated, and
  // Radix's portal-driven mount lifecycle means the ref isn't
  // necessarily populated by the time the *first* `useEffect` runs.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [error, setError] = useState<ScannerError | null>(null)
  // Retry counter forces the effect to re-run when the user taps
  // "Erneut versuchen" after a permission denial.
  const [retryNonce, setRetryNonce] = useState(0)
  const scanNavigate = useScanNavigation()

  useEffect(() => {
    if (!open || !video) return

    let cancelled = false
    let scanner: { stop: () => void; destroy: () => void } | null = null

    setError(null)
    ;(async () => {
      try {
        const QrScanner = (await import("qr-scanner")).default
        if (cancelled) return
        const instance = new QrScanner(
          video,
          (result: { data: string }) => {
            const intent = parseCheckoutQr(result.data)
            if (!intent) {
              // qr-scanner fires onDecode every successfully read frame
              // (up to ~25 fps); a stable toast id prevents the warning
              // from stacking while the camera is aimed at a non-werkstatt
              // QR.
              toast.error("Kein gültiger Werkstatt-QR-Code", {
                id: "invalid-qr",
              })
              return
            }
            if (typeof navigator.vibrate === "function") navigator.vibrate(50)
            onOpenChange(false)
            scanNavigate(intent)
          },
          {
            highlightScanRegion: false,
            highlightCodeOutline: false,
            preferredCamera: "environment",
          },
        )
        scanner = instance
        await instance.start()
        if (cancelled) {
          instance.stop()
          instance.destroy()
        }
      } catch (err) {
        if (cancelled) return
        const name = (err as { name?: string } | null)?.name
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError("permission")
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setError("no-camera")
        } else {
          setError("generic")
        }
      }
    })()

    return () => {
      cancelled = true
      scanner?.stop()
      scanner?.destroy()
    }
  }, [open, video, retryNonce, onOpenChange, scanNavigate])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-full w-full max-w-none rounded-none border-0 p-0 bg-black flex flex-col gap-0"
        showCloseButton={false}
      >
        <VisuallyHidden.Root>
          <SheetTitle>QR-Code scannen</SheetTitle>
          <SheetDescription>
            Halte den QR-Code im Rahmen, um Material hinzuzufügen.
          </SheetDescription>
        </VisuallyHidden.Root>

        <button
          type="button"
          aria-label="Scanner schliessen"
          onClick={() => onOpenChange(false)}
          className="absolute top-4 left-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm"
        >
          <X className="h-5 w-5" />
        </button>

        {/* The video element stays mounted across error/retry cycles so
            the ref callback fires exactly once and `useEffect` can re-run
            cleanly by bumping `retryNonce`. The error UI is overlaid. */}
        <video
          ref={setVideo}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
        />
        {error ? (
          <ScannerErrorState
            error={error}
            onRetry={() => {
              setError(null)
              setRetryNonce((n) => n + 1)
            }}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <Viewfinder />
        )}
      </SheetContent>
    </Sheet>
  )
}

function Viewfinder() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center text-white"
    >
      <div className="relative h-[70vw] max-h-[70vh] w-[70vw] max-w-[70vh] rounded-3xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />
      <p className="mt-6 px-6 text-center text-sm font-medium">
        QR-Code im Rahmen halten
      </p>
    </div>
  )
}

function ScannerErrorState({
  error,
  onRetry,
  onClose,
}: {
  error: ScannerError
  onRetry: () => void
  onClose: () => void
}) {
  const { title, body, showRetry } = describeError(error)
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <Camera className="h-10 w-10 text-muted-foreground" />
      <h2 className="font-heading text-xl font-bold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      <div className="mt-2 flex gap-3">
        {showRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="h-10 rounded-[3px] bg-cog-teal px-4 text-sm font-semibold text-white hover:bg-cog-teal-dark"
          >
            Erneut versuchen
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-[3px] border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-secondary"
        >
          Schliessen
        </button>
      </div>
    </div>
  )
}

function describeError(error: ScannerError) {
  switch (error) {
    case "permission":
      return {
        title: "Kamera-Zugriff verweigert",
        body: "Erlaube den Kamera-Zugriff in den Browser-Einstellungen, um QR-Codes zu scannen.",
        showRetry: true,
      }
    case "no-camera":
      return {
        title: "Keine Kamera gefunden",
        body: "Auf diesem Gerät ist keine Kamera verfügbar. Tippe den Code stattdessen ein.",
        showRetry: false,
      }
    case "generic":
    default:
      return {
        title: "Scanner konnte nicht gestartet werden",
        body: "Etwas ist schiefgelaufen. Versuch es erneut.",
        showRetry: true,
      }
  }
}
