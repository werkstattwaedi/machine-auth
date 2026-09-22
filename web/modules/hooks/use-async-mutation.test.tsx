// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { useAsyncMutation } from "./use-async-mutation"
import { FirebaseProvider, type FirebaseServices } from "../lib/firebase-context"

// Spy on the functions-module callable so we can assert telemetry.
const mockLogClientErrorCallable = vi
  .fn()
  .mockResolvedValue({ data: { ok: true } })
const mockHttpsCallable = vi.fn().mockReturnValue(mockLogClientErrorCallable)

vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}))

// Mock sonner toast — must match the import path the hook uses.
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

function createWrapper() {
  const services: FirebaseServices = {
    db: {} as FirebaseServices["db"],
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return ({ children }: { children: ReactNode }) => (
    <FirebaseProvider value={services}>{children}</FirebaseProvider>
  )
}

/** Build a `FirebaseError`-shape object — same fields the SDK uses. */
function firebaseError(code: string, message: string) {
  return Object.assign(new Error(message), { code, name: "FirebaseError" })
}

describe("useAsyncMutation", () => {
  beforeEach(() => {
    sessionStorage.clear()
    mockHttpsCallable.mockClear()
    mockLogClientErrorCallable.mockClear()
    mockLogClientErrorCallable.mockResolvedValue({ data: { ok: true } })
    mockToastSuccess.mockClear()
    mockToastError.mockClear()
  })

  it("resolves with the wrapped value and does not toast by default", async () => {
    const { result } = renderHook(
      () => useAsyncMutation<string>({ context: "test.success" }),
      { wrapper: createWrapper() },
    )

    let value: string | undefined
    await act(async () => {
      value = await result.current.mutate(() => Promise.resolve("ok"))
    })

    expect(value).toBe("ok")
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it("toasts the success message when provided", async () => {
    const { result } = renderHook(
      () =>
        useAsyncMutation({
          context: "test.success-toast",
          successMessage: "Gespeichert",
        }),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      await result.current.mutate(() => Promise.resolve())
    })

    expect(mockToastSuccess).toHaveBeenCalledWith("Gespeichert")
  })

  it("toasts errorMessage and reports telemetry for a generic Error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { result } = renderHook(
      () =>
        useAsyncMutation({
          context: "test.generic",
          errorMessage: "Speichern fehlgeschlagen",
        }),
      { wrapper: createWrapper() },
    )

    const original = new Error("boom")
    let thrown: unknown = null
    await act(async () => {
      try {
        await result.current.mutate(() => Promise.reject(original))
      } catch (err) {
        thrown = err
      }
    })

    // Re-throws original error (not the structured wrapper).
    expect(thrown).toBe(original)

    // Toast uses the errorMessage fallback.
    expect(mockToastError).toHaveBeenCalledWith("Speichern fehlgeschlagen")

    // State is populated with code "unknown".
    expect(result.current.error?.code).toBe("unknown")
    expect(result.current.error?.message).toBe("Speichern fehlgeschlagen")
    expect(result.current.error?.originalError).toBe(original)
    expect(result.current.loading).toBe(false)

    // Telemetry callable was wired up and invoked once with the right payload.
    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      "logClientError",
    )
    expect(mockLogClientErrorCallable).toHaveBeenCalledTimes(1)
    const payload = mockLogClientErrorCallable.mock.calls[0][0] as {
      sessionId: string
      context: string
      code: string
      message: string
      path: string
    }
    expect(payload.context).toBe("test.generic")
    expect(payload.code).toBe("unknown")
    expect(payload.message).toBe("boom")
    expect(payload.path).toBe("")
    expect(payload.sessionId).toMatch(/^[0-9a-z]{8}$/)

    consoleSpy.mockRestore()
  })

  it("maps FirebaseError code permission-denied to a German message", async () => {
    const { result } = renderHook(
      () =>
        useAsyncMutation({
          context: "test.permission",
          errorMessage: "Speichern fehlgeschlagen",
        }),
      { wrapper: createWrapper() },
    )

    const original = firebaseError(
      "permission-denied",
      "Missing or insufficient permissions.",
    )

    await act(async () => {
      try {
        await result.current.mutate(() => Promise.reject(original))
      } catch {
        /* expected */
      }
    })

    // Toast uses the German mapped message, NOT the raw English one.
    expect(mockToastError).toHaveBeenCalledWith(
      "Keine Berechtigung für diese Aktion.",
    )
    expect(result.current.error?.code).toBe("permission-denied")
    expect(result.current.error?.message).toBe(
      "Keine Berechtigung für diese Aktion.",
    )
  })

  it("shows an app-level (oww/…) error's own message instead of the fallback", async () => {
    const { result } = renderHook(
      () =>
        useAsyncMutation({
          context: "test.appError",
          errorMessage: "Google-Anmeldung fehlgeschlagen",
        }),
      { wrapper: createWrapper() },
    )

    const refusal = Object.assign(
      new Error("Für diese E-Mail existiert bereits ein Konto. Bitte melde dich per E-Mail-Code an."),
      { code: "oww/existing-account" },
    )

    await act(async () => {
      try {
        await result.current.mutate(() => Promise.reject(refusal))
      } catch {
        /* expected */
      }
    })

    // The refusal tells the member what to do next — the generic
    // errorMessage must not replace it.
    expect(mockToastError).toHaveBeenCalledWith(refusal.message)
    expect(result.current.error?.code).toBe("oww/existing-account")
  })

  // Issue #628: `closeCheckoutAndGetPayment` throws `failed-precondition`
  // with a user-facing German reason; the generic „Bitte erneut versuchen"
  // hid it. The carve-out is opt-in per call site so the many callables whose
  // failed-precondition messages are English internals keep the fallback.
  it("shows the server message for a code listed in serverMessageCodes", async () => {
    const { result } = renderHook(
      () =>
        useAsyncMutation({
          context: "checkout.closeAndPay",
          errorMessage:
            "Bezahlung konnte nicht erstellt werden. Bitte erneut versuchen.",
          serverMessageCodes: ["functions/failed-precondition"],
        }),
      { wrapper: createWrapper() },
    )

    const original = firebaseError(
      "functions/failed-precondition",
      "Materialbezug ist nicht möglich, wenn Maschinen genutzt wurden.",
    )

    await act(async () => {
      try {
        await result.current.mutate(() => Promise.reject(original))
      } catch {
        /* expected */
      }
    })

    expect(mockToastError).toHaveBeenCalledWith(original.message)
    expect(result.current.error?.message).toBe(original.message)
    expect(result.current.error?.code).toBe("functions/failed-precondition")
  })

  it("keeps the fallback for functions/failed-precondition when not opted in", async () => {
    const { result } = renderHook(
      () =>
        useAsyncMutation({
          context: "test.failed-precondition",
          errorMessage: "Speichern fehlgeschlagen",
        }),
      { wrapper: createWrapper() },
    )

    const original = firebaseError(
      "functions/failed-precondition",
      "Pricing config missing standard entry fee for erwachsen",
    )

    await act(async () => {
      try {
        await result.current.mutate(() => Promise.reject(original))
      } catch {
        /* expected */
      }
    })

    expect(mockToastError).toHaveBeenCalledWith("Speichern fehlgeschlagen")
    expect(result.current.error?.message).toBe("Speichern fehlgeschlagen")
  })

  it("maps FunctionsError code unavailable to the offline German message", async () => {
    const { result } = renderHook(
      () => useAsyncMutation({ context: "test.unavailable" }),
      { wrapper: createWrapper() },
    )

    const original = Object.assign(
      new Error("The service is currently unavailable."),
      { code: "unavailable", name: "FirebaseError" },
    )

    await act(async () => {
      try {
        await result.current.mutate(() => Promise.reject(original))
      } catch {
        /* expected */
      }
    })

    expect(mockToastError).toHaveBeenCalledWith(
      "Verbindung zum Server fehlgeschlagen. Bitte erneut versuchen.",
    )
    expect(mockLogClientErrorCallable).toHaveBeenCalledTimes(1)
    const payload = mockLogClientErrorCallable.mock.calls[0][0] as {
      code: string
    }
    expect(payload.code).toBe("unavailable")
  })

  it("forwards the path argument into telemetry", async () => {
    const { result } = renderHook(
      () => useAsyncMutation({ context: "firestore.write" }),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      try {
        await result.current.mutate(
          () => Promise.reject(new Error("nope")),
          "users/u1",
        )
      } catch {
        /* expected */
      }
    })

    const payload = mockLogClientErrorCallable.mock.calls[0][0] as {
      path: string
    }
    expect(payload.path).toBe("users/u1")
  })

  it("reset() clears error and allows a follow-up successful mutate", async () => {
    const { result } = renderHook(
      () => useAsyncMutation({ context: "test.reset" }),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      try {
        await result.current.mutate(() => Promise.reject(new Error("first")))
      } catch {
        /* expected */
      }
    })
    expect(result.current.error).not.toBeNull()

    act(() => {
      result.current.reset()
    })
    expect(result.current.error).toBeNull()

    await act(async () => {
      await result.current.mutate(() => Promise.resolve())
    })
    expect(result.current.error).toBeNull()
  })

  it("re-throws the original error even when telemetry rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    // Simulate telemetry callable itself rejecting.
    mockLogClientErrorCallable.mockRejectedValueOnce(
      new Error("telemetry down"),
    )

    const { result } = renderHook(
      () => useAsyncMutation({ context: "test.telemetry-failure" }),
      { wrapper: createWrapper() },
    )

    const original = new Error("primary failure")
    let thrown: unknown = null
    await act(async () => {
      try {
        await result.current.mutate(() => Promise.reject(original))
      } catch (err) {
        thrown = err
      }
    })

    // Caller still sees the ORIGINAL error, not the telemetry one.
    expect(thrown).toBe(original)

    // Yield once for the telemetry rejection to be handled (and swallowed)
    // before the test ends so we don't leak an unhandled rejection.
    await waitFor(() => {
      expect(mockLogClientErrorCallable).toHaveBeenCalled()
    })

    consoleSpy.mockRestore()
  })

  it("tracks loading state across an in-flight mutation", async () => {
    const { result } = renderHook(
      () => useAsyncMutation({ context: "test.loading" }),
      { wrapper: createWrapper() },
    )

    expect(result.current.loading).toBe(false)

    let resolveFn: () => void
    const pending = new Promise<void>((resolve) => {
      resolveFn = resolve
    })

    act(() => {
      result.current.mutate(() => pending)
    })

    await waitFor(() => expect(result.current.loading).toBe(true))

    await act(async () => {
      resolveFn!()
      await pending
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
  })
})
