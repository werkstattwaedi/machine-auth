// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, afterEach } from "vitest"
import { ConfirmDialog } from "./confirm-dialog"

afterEach(cleanup)

describe("ConfirmDialog", () => {
  it("renders title, description, and buttons when open", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Eintrag löschen?"
        description="Das kann nicht rückgängig gemacht werden."
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText("Eintrag löschen?")).toBeTruthy()
    expect(screen.getByText("Das kann nicht rückgängig gemacht werden.")).toBeTruthy()
    expect(screen.getByText("Abbrechen")).toBeTruthy()
    expect(screen.getByText("Bestätigen")).toBeTruthy()
  })

  it("is not visible when open is false", () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={vi.fn()}
        title="Hidden"
        description="Should not show"
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.queryByText("Hidden")).toBeNull()
  })

  it("calls onConfirm when confirm button is clicked", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Confirm?"
        description="Please confirm."
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByText("Bestätigen"))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("calls onOpenChange(false) when cancel button is clicked", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Cancel test"
        description="Test cancel."
        onConfirm={vi.fn()}
      />,
    )

    await user.click(screen.getByText("Abbrechen"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("renders custom confirm label", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Custom label"
        description="Test"
        onConfirm={vi.fn()}
        confirmLabel="Ja, löschen"
      />,
    )

    expect(screen.getByText("Ja, löschen")).toBeTruthy()
    expect(screen.queryByText("Bestätigen")).toBeNull()
  })

  it("disables confirm button when confirmDisabled is true", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Disabled"
        description="Test"
        onConfirm={vi.fn()}
        confirmDisabled={true}
      />,
    )

    const confirmBtn = screen.getByText("Bestätigen").closest("button")!
    expect(confirmBtn).toBeDisabled()
  })
})
