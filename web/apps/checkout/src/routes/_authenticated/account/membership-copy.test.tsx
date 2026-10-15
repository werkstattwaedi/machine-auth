// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Only machine catalog items carry a member price, so every membership
// pitch must promise a machine discount and never one on material
// (issue #665).

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => () => {},
}))

import { StatusHero, NoMembership } from "./membership"
import { MEMBER_DISCOUNT_BENEFIT } from "@/lib/membership-copy"

const heroProps = {
  validUntil: "31.12.2026",
  autoRenew: true,
  loading: false,
  onRenew: () => {},
  onCancelAutoRenew: null,
} as const

afterEach(cleanup)

describe("membership benefit copy", () => {
  it("active single hero promises a machine discount only", () => {
    const { container } = render(
      <StatusHero {...heroProps} type="single" status="active" isOwner />,
    )
    expect(container.textContent).toContain(MEMBER_DISCOUNT_BENEFIT)
    expect(container.textContent).not.toContain("Material")
  })

  it("active family member hero promises a machine discount only", () => {
    const { container } = render(
      <StatusHero {...heroProps} type="family" status="active" isOwner={false} />,
    )
    expect(container.textContent).toContain(MEMBER_DISCOUNT_BENEFIT)
    expect(container.textContent).not.toContain("Material")
  })

  // The renewal bill goes to the family's owner, never to an invited
  // member (issue #730).
  it("family member is not promised the renewal bill", () => {
    const { container } = render(
      <StatusHero {...heroProps} type="family" status="active" isOwner={false} />,
    )
    expect(container.textContent).not.toContain("erhältst du eine Rechnung")
    expect(container.textContent).toContain(
      "Die Rechnung erhält die Inhaber:in der Familie.",
    )
  })

  it.each([
    ["family owner", "family"],
    ["single member", "single"],
  ] as const)("%s is told they receive the renewal bill", (_, type) => {
    const { container } = render(
      <StatusHero {...heroProps} type={type} status="active" isOwner />,
    )
    expect(container.textContent).toContain("erhältst du eine Rechnung")
    expect(container.textContent).not.toContain("Die Rechnung erhält")
  })

  it("purchase cards list the same benefit", () => {
    const { container } = render(
      <NoMembership
        onPurchase={() => {}}
        loading={false}
        priceByType={{ single: "CHF 50.00", family: "CHF 80.00" }}
      />,
    )
    expect(container.textContent).toContain(MEMBER_DISCOUNT_BENEFIT)
    expect(container.textContent).not.toContain("Material")
  })

  it("the shared benefit names machines, not material", () => {
    expect(MEMBER_DISCOUNT_BENEFIT).toMatch(/Maschinennutzung/)
    expect(MEMBER_DISCOUNT_BENEFIT).not.toMatch(/Material/)
  })
})
