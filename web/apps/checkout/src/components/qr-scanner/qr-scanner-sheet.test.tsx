// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"
import { QrScannerSheet } from "./qr-scanner-sheet"

// `vi.mock` factories are hoisted to the top of the file, so anything they
// reference must be defined inside `vi.hoisted` (which is also hoisted).
const m = vi.hoisted(() => {
  let lastDecode: ((r: { data: string }) => void) | null = null
  return {
    startSpy: vi.fn(async () => {}),
    stopSpy: vi.fn(),
    destroySpy: vi.fn(),
    toastError: vi.fn(),
    scanNavigate: vi.fn(),
    captureDecode: (cb: (r: { data: string }) => void) => {
      lastDecode = cb
    },
    fireDecode: (data: string) => lastDecode?.({ data }),
    getLastDecode: () => lastDecode,
    resetDecode: () => {
      lastDecode = null
    },
  }
})

vi.mock("qr-scanner", () => {
  class MockQrScanner {
    start: typeof m.startSpy
    stop: typeof m.stopSpy
    destroy: typeof m.destroySpy
    constructor(_v: HTMLVideoElement, cb: (r: { data: string }) => void) {
      m.captureDecode(cb)
      this.start = m.startSpy
      this.stop = m.stopSpy
      this.destroy = m.destroySpy
    }
  }
  return { default: MockQrScanner }
})

vi.mock("./use-scan-navigation", () => ({
  useScanNavigation: () => m.scanNavigate,
}))

vi.mock("sonner", () => ({
  toast: { error: m.toastError, success: vi.fn(), info: vi.fn() },
}))

beforeEach(() => {
  m.resetDecode()
  m.startSpy.mockReset().mockResolvedValue(undefined)
  m.stopSpy.mockReset()
  m.destroySpy.mockReset()
  m.scanNavigate.mockReset()
  m.toastError.mockReset()
})

async function waitForDecoder() {
  await waitFor(() => expect(m.getLastDecode()).not.toBeNull())
  await waitFor(() => expect(m.startSpy).toHaveBeenCalled())
}

describe("QrScannerSheet", () => {
  it("starts the scanner when open", async () => {
    render(<QrScannerSheet open onOpenChange={vi.fn()} />)
    await waitForDecoder()
    expect(m.startSpy).toHaveBeenCalledTimes(1)
  })

  it("does not start the scanner while closed (camera-leak guard)", async () => {
    // Picker mounts <QrScannerSheet open={false} ...> alongside the
    // search input; if this guard ever regresses, every picker open
    // would silently request the camera.
    render(<QrScannerSheet open={false} onOpenChange={vi.fn()} />)
    // Give microtasks a chance to flush in case some accidental
    // initialization is queued.
    await Promise.resolve()
    expect(m.startSpy).not.toHaveBeenCalled()
    expect(m.getLastDecode()).toBeNull()
  })

  it("stops + destroys the scanner on unmount", async () => {
    const { unmount } = render(
      <QrScannerSheet open onOpenChange={vi.fn()} />,
    )
    await waitForDecoder()
    unmount()
    expect(m.stopSpy).toHaveBeenCalled()
    expect(m.destroySpy).toHaveBeenCalled()
  })

  it("navigates and closes on a valid /visit/add/list/<id> scan", async () => {
    const onOpenChange = vi.fn()
    render(<QrScannerSheet open onOpenChange={onOpenChange} />)
    await waitForDecoder()
    act(() => {
      m.fireDecode(
        "https://checkout.werkstattwaedi.ch/visit/add/list/abc123",
      )
    })
    expect(m.scanNavigate).toHaveBeenCalledWith({
      kind: "list",
      listId: "abc123",
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(m.toastError).not.toHaveBeenCalled()
  })

  it("toasts and keeps scanning on an invalid QR", async () => {
    const onOpenChange = vi.fn()
    render(<QrScannerSheet open onOpenChange={onOpenChange} />)
    await waitForDecoder()
    act(() => {
      m.fireDecode("WIFI:T:WPA;S:home;P:secret;;")
    })
    expect(m.toastError).toHaveBeenCalledWith(
      "Kein gültiger Werkstatt-QR-Code",
      { id: "invalid-qr" },
    )
    expect(m.scanNavigate).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("renders the permission-denied retry UI when start() rejects with NotAllowedError", async () => {
    const denied = Object.assign(new Error("denied"), {
      name: "NotAllowedError",
    })
    m.startSpy.mockReset().mockRejectedValueOnce(denied)
    render(<QrScannerSheet open onOpenChange={vi.fn()} />)
    expect(
      await screen.findByText("Kamera-Zugriff verweigert"),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Erneut versuchen" }),
    ).toBeInTheDocument()
  })

  it("re-runs the start sequence when retry is tapped", async () => {
    const denied = Object.assign(new Error("denied"), {
      name: "NotAllowedError",
    })
    m.startSpy.mockReset()
    m.startSpy.mockRejectedValueOnce(denied).mockResolvedValueOnce(undefined)
    render(<QrScannerSheet open onOpenChange={vi.fn()} />)
    const retry = await screen.findByRole("button", {
      name: "Erneut versuchen",
    })
    fireEvent.click(retry)
    await waitFor(() => expect(m.startSpy).toHaveBeenCalledTimes(2))
  })
})
