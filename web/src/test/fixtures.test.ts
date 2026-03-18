// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { TestFixture } from "./fixtures"

describe("TestFixture", () => {
  it("seeds users with permission refs", () => {
    const { db } = new TestFixture()
      .withPermission({ id: "laser", name: "Laser" })
      .withUser({ id: "u1", displayName: "Max", permissions: ["laser"] })
      .buildFake()

    const userData = db.getData("users", "u1")!
    expect(userData.displayName).toBe("Max")
    const perms = userData.permissions as { path: string }[]
    expect(perms).toHaveLength(1)
    expect(perms[0].path).toBe("permission/laser")
  })

  it("seeds machines with permission and maco refs", () => {
    const { db } = new TestFixture()
      .withPermission({ id: "laser", name: "Laser" })
      .withMaco({ id: "term1", name: "Terminal 1" })
      .withMachine({ id: "m1", name: "Laser", requiredPermission: ["laser"], maco: "term1" })
      .buildFake()

    const machineData = db.getData("machine", "m1")!
    expect(machineData.name).toBe("Laser")
    expect((machineData.maco as { path: string }).path).toBe("maco/term1")
  })

  it("seeds checkouts with items", () => {
    const { db } = new TestFixture()
      .withUser({ id: "u1", displayName: "Max" })
      .withCheckout({
        id: "co1",
        userId: "u1",
        items: [
          { id: "i1", workshop: "holz", description: "Test", quantity: 1, unitPrice: 10, totalPrice: 10 },
        ],
      })
      .buildFake()

    const coData = db.getData("checkouts", "co1")!
    expect((coData.userId as { path: string }).path).toBe("users/u1")

    const itemData = db.getData("checkouts/co1/items", "i1")!
    expect(itemData.description).toBe("Test")
  })

  it("seeds pricing config", () => {
    const { db } = new TestFixture()
      .withPricingConfig({
        entryFees: { erwachsen: { regular: 15 } },
        workshops: { holz: { label: "Holz", order: 1 } },
      })
      .buildFake()

    const config = db.getData("config", "pricing")!
    expect(config.entryFees).toEqual({ erwachsen: { regular: 15 } })
  })

  it("sets current user in FakeAuth", () => {
    const { auth } = new TestFixture()
      .withUser({ id: "u1", email: "max@test.com" })
      .buildFake({ currentUser: "u1" })

    expect(auth.currentUser).not.toBeNull()
    expect(auth.currentUser!.uid).toBe("u1")
  })

  it("preset: memberWithCheckout", () => {
    const { db, auth } = TestFixture.memberWithCheckout().buildFake({ currentUser: "member1" })
    expect(db.getData("users", "member1")).toBeTruthy()
    expect(db.getData("checkouts", "co1")).toBeTruthy()
    expect(db.getData("checkouts/co1/items", "item1")).toBeTruthy()
    expect(db.getData("config", "pricing")).toBeTruthy()
    expect(auth.currentUser?.uid).toBe("member1")
  })

  it("preset: adminDashboard", () => {
    const { db } = TestFixture.adminDashboard().buildFake()
    expect(db.getData("users", "admin1")).toBeTruthy()
    expect(db.getData("users", "user1")).toBeTruthy()
    expect(db.getData("machine", "m1")).toBeTruthy()
    expect(db.getData("machine", "m2")).toBeTruthy()
    expect(db.getData("permission", "laser")).toBeTruthy()
    expect(db.getData("permission", "cnc")).toBeTruthy()
  })
})
