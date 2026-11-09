// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"

const toastMock = vi.fn()
vi.mock("sonner", () => ({ toast: (...args: unknown[]) => toastMock(...args) }))

const {
  ClientVersionGateView,
  clientVersionState,
  shouldAutoReload,
} = await import("./client-version")
const { reportClientOutdated, resetClientOutdatedForTest } = await import(
  "./client-outdated"
)

afterEach(() => {
  cleanup()
  toastMock.mockReset()
  resetClientOutdatedForTest()
  sessionStorage.clear()
})

describe("clientVersionState", () => {
  const base = { build: "2026.11.3", minVersion: null, deployed: null, serverOutdated: false }

  it("is ok while the deployed version is the running one", () => {
    expect(clientVersionState({ ...base, deployed: "2026.11.3" })).toBe("ok")
  })

  it("offers an update when another version is deployed", () => {
    expect(clientVersionState({ ...base, deployed: "2026.11.4" })).toBe("update-available")
  })

  it("is outdated below the minimum or when the server said so", () => {
    expect(clientVersionState({ ...base, minVersion: "2026.11.4" })).toBe("outdated")
    expect(clientVersionState({ ...base, serverOutdated: true })).toBe("outdated")
  })

  it("never bothers a dev build", () => {
    expect(
      clientVersionState({ ...base, build: "dev", deployed: "2026.11.4", minVersion: "2026.11.4" }),
    ).toBe("ok")
  })
})

describe("shouldAutoReload", () => {
  const base = { build: "2026.11.3", minVersion: "2026.11.4", lastReloadFor: null }

  it("reloads once the deployed build meets the minimum", () => {
    expect(shouldAutoReload({ ...base, deployed: "2026.11.4" })).toBe(true)
  })

  it("does not reload into a build that is still too old", () => {
    expect(shouldAutoReload({ ...base, deployed: "2026.11.3" })).toBe(false)
    expect(shouldAutoReload({ ...base, deployed: null })).toBe(false)
  })

  it("reloads at most once per deployed build", () => {
    expect(shouldAutoReload({ ...base, deployed: "2026.11.4", lastReloadFor: "2026.11.4" })).toBe(
      false,
    )
  })
})

describe("ClientVersionGateView", () => {
  it("shows a lasting reload hint when a newer version is deployed", async () => {
    const reload = vi.fn()
    render(
      <ClientVersionGateView
        build="2026.11.3"
        minVersion={null}
        kiosk={false}
        fetchDeployed={async () => "2026.11.4"}
        reload={reload}
      />,
    )
    await waitFor(() => expect(toastMock).toHaveBeenCalled())
    const [text, opts] = toastMock.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ]
    expect(text).toBe("Eine neue Version ist verfügbar.")
    expect(opts.duration).toBe(Infinity)
    opts.action.onClick()
    expect(reload).toHaveBeenCalledOnce()
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("shows the hint once per deployed version, not again on re-render", async () => {
    const props = {
      build: "2026.11.3",
      kiosk: false,
      fetchDeployed: async () => "2026.11.4",
      reload: vi.fn(),
    }
    const { rerender } = render(<ClientVersionGateView {...props} minVersion={null} />)
    await waitFor(() => expect(toastMock).toHaveBeenCalledOnce())
    rerender(<ClientVersionGateView {...props} minVersion="2026.1.1" />)
    rerender(<ClientVersionGateView {...props} minVersion={null} />)
    expect(toastMock).toHaveBeenCalledOnce()
  })

  it("reloads once a later check finds the new build", async () => {
    const reload = vi.fn()
    let served = "2026.11.3"
    render(
      <ClientVersionGateView
        build="2026.11.3"
        minVersion="2026.11.4"
        kiosk={false}
        fetchDeployed={async () => served}
        reload={reload}
      />,
    )
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy())
    expect(reload).not.toHaveBeenCalled()
    served = "2026.11.4"
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
  })

  it("shows no hint at the kiosk", async () => {
    const fetchDeployed = vi.fn(async () => "2026.11.4")
    render(
      <ClientVersionGateView
        build="2026.11.3"
        minVersion={null}
        kiosk
        fetchDeployed={fetchDeployed}
        reload={vi.fn()}
      />,
    )
    await waitFor(() => expect(fetchDeployed).toHaveBeenCalled())
    expect(toastMock).not.toHaveBeenCalled()
  })

  it("blocks below the minimum and reloads once the new build is served", async () => {
    const reload = vi.fn()
    render(
      <ClientVersionGateView
        build="2026.11.3"
        minVersion="2026.11.4"
        kiosk={false}
        fetchDeployed={async () => "2026.11.4"}
        reload={reload}
      />,
    )
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(screen.getByText("Die App wurde aktualisiert")).toBeTruthy()
    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(sessionStorage.getItem("oww.clientVersionReload")).toBe("2026.11.4")
  })

  it("stays blocked without reloading while the old build is still served", async () => {
    const reload = vi.fn()
    const fetchDeployed = vi.fn(async () => "2026.11.3")
    render(
      <ClientVersionGateView
        build="2026.11.3"
        minVersion="2026.11.4"
        kiosk={false}
        fetchDeployed={fetchDeployed}
        reload={reload}
      />,
    )
    await waitFor(() => expect(fetchDeployed).toHaveBeenCalledTimes(2))
    expect(reload).not.toHaveBeenCalled()
    screen.getByRole("button", { name: "Neu laden" }).click()
    expect(reload).toHaveBeenCalledOnce()
  })

  it("blocks when a function call was refused as outdated", async () => {
    render(
      <ClientVersionGateView
        build="2026.11.3"
        minVersion={null}
        kiosk={false}
        fetchDeployed={async () => null}
        reload={vi.fn()}
      />,
    )
    expect(screen.queryByRole("alertdialog")).toBeNull()
    act(() => reportClientOutdated())
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })
})
