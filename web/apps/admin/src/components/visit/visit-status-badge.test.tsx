// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { VisitStatusBadge } from "./visit-status-badge"

afterEach(cleanup)

describe("VisitStatusBadge", () => {
  it.each([
    ["open", "offen"],
    ["awaiting_payment", "Zahlung ausstehend"],
    ["closed", "abgerechnet"],
    ["cancelled", "storniert"],
  ] as const)("labels %s as %s", (status, label) => {
    render(<VisitStatusBadge status={status} />)
    expect(screen.getByText(label)).toBeTruthy()
  })
})
