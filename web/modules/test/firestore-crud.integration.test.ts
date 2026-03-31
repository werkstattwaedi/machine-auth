// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Integration tests verifying Firestore CRUD operations against the emulator.
 * Tests the data model, reference handling, and query patterns used by the app.
 *
 * Run with: npm run test:web:integration (from repo root)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getAdminFirestore,
  seedDoc,
} from "./emulator-helper"
import { FieldValue } from "firebase-admin/firestore"

beforeAll(async () => {
  await setupEmulator()
})

afterEach(async () => {
  await clearFirestore()
})

afterAll(async () => {
  await teardownEmulator()
})

describe("Firestore data model", () => {
  it("creates users with permission DocumentReferences", async () => {
    const db = getAdminFirestore()

    // Seed permission first
    await seedDoc("permission", "laser", { name: "Laser Cutter" })

    // Seed user with permission reference (string path → auto-converted)
    await seedDoc("users", "u1", {
      displayName: "Max Muster",
      name: "Max Muster",
      email: "max@test.com",
      roles: ["vereinsmitglied"],
      permissions: ["/permission/laser"],
      userType: "erwachsen",
    })

    const userSnap = await db.collection("users").doc("u1").get()
    const userData = userSnap.data()!
    expect(userData.displayName).toBe("Max Muster")
    expect(userData.roles).toEqual(["vereinsmitglied"])

    // Verify permissions are real DocumentReferences
    const permRefs = userData.permissions
    expect(permRefs).toHaveLength(1)
    expect(permRefs[0].path).toBe("permission/laser")

    // Resolve the reference
    const permSnap = await permRefs[0].get()
    expect(permSnap.data()?.name).toBe("Laser Cutter")
  })

  it("creates machines linked to permissions and maco terminals", async () => {
    const db = getAdminFirestore()

    await seedDoc("permission", "cnc", { name: "CNC Fräse" })
    await seedDoc("maco", "term1", { name: "Terminal 1" })
    await seedDoc("machine", "m1", {
      name: "CNC Machine",
      requiredPermission: ["/permission/cnc"],
      maco: "/maco/term1",
    })

    const machineSnap = await db.collection("machine").doc("m1").get()
    const machineData = machineSnap.data()!
    expect(machineData.name).toBe("CNC Machine")
    expect(machineData.requiredPermission[0].path).toBe("permission/cnc")
    expect(machineData.maco.path).toBe("maco/term1")
  })
})

describe("Checkout flow", () => {
  it("creates an open checkout, adds items, then closes it", async () => {
    const db = getAdminFirestore()

    // Seed user
    await seedDoc("users", "u1", {
      displayName: "Max",
      roles: ["vereinsmitglied"],
      permissions: [],
    })

    // 1. Create open checkout
    const userRef = db.doc("users/u1")
    const checkoutRef = await db.collection("checkouts").add({
      userId: userRef,
      status: "open",
      usageType: "regular",
      created: FieldValue.serverTimestamp(),
      workshopsVisited: ["holz"],
      persons: [],
    })

    // Verify it was created
    const coSnap = await checkoutRef.get()
    expect(coSnap.data()?.status).toBe("open")
    expect(coSnap.data()?.userId.path).toBe("users/u1")

    // 2. Add items to checkout subcollection
    await db.collection(`checkouts/${checkoutRef.id}/items`).add({
      workshop: "holz",
      description: "Laser Stunde",
      origin: "manual",
      catalogId: null,
      quantity: 2,
      unitPrice: 15,
      totalPrice: 30,
      created: FieldValue.serverTimestamp(),
    })

    await db.collection(`checkouts/${checkoutRef.id}/items`).add({
      workshop: "holz",
      description: "MDF Platte",
      origin: "qr",
      catalogId: db.doc("catalog/mdf1"),
      quantity: 1,
      unitPrice: 5,
      totalPrice: 5,
      created: FieldValue.serverTimestamp(),
    })

    // Verify items
    const itemsSnap = await db
      .collection(`checkouts/${checkoutRef.id}/items`)
      .get()
    expect(itemsSnap.size).toBe(2)

    const items = itemsSnap.docs.map((d) => d.data())
    const descriptions = items.map((i) => i.description).sort()
    expect(descriptions).toEqual(["Laser Stunde", "MDF Platte"])

    // 3. Close the checkout
    await checkoutRef.update({
      status: "closed",
      closedAt: FieldValue.serverTimestamp(),
      summary: {
        totalPrice: 35,
        entryFees: 15,
        machineCost: 0,
        materialCost: 35,
        tip: 0,
      },
      persons: [{ name: "Max", email: "max@test.com", userType: "erwachsen" }],
    })

    const closedSnap = await checkoutRef.get()
    expect(closedSnap.data()?.status).toBe("closed")
    expect(closedSnap.data()?.summary.totalPrice).toBe(35)
    expect(closedSnap.data()?.closedAt).toBeTruthy()
  })

  it("queries open checkouts by user reference", async () => {
    const db = getAdminFirestore()

    const u1Ref = db.doc("users/u1")
    const u2Ref = db.doc("users/u2")

    // Create checkouts for different users
    await db.collection("checkouts").add({
      userId: u1Ref,
      status: "open",
      usageType: "regular",
      created: FieldValue.serverTimestamp(),
    })
    await db.collection("checkouts").add({
      userId: u2Ref,
      status: "open",
      usageType: "regular",
      created: FieldValue.serverTimestamp(),
    })
    await db.collection("checkouts").add({
      userId: u1Ref,
      status: "closed",
      usageType: "regular",
      created: FieldValue.serverTimestamp(),
    })

    // Query: u1's open checkouts
    const snap = await db
      .collection("checkouts")
      .where("userId", "==", u1Ref)
      .where("status", "==", "open")
      .get()

    expect(snap.size).toBe(1)
    expect(snap.docs[0].data().userId.path).toBe("users/u1")
  })
})

describe("Catalog and pricing config", () => {
  it("stores and retrieves pricing config", async () => {
    const db = getAdminFirestore()

    await seedDoc("config", "pricing", {
      entryFees: {
        erwachsen: { regular: 15, materialbezug: 0, intern: 0 },
        kind: { regular: 7.5, materialbezug: 0, intern: 0 },
        firma: { regular: 30, materialbezug: 0, intern: 0 },
      },
      workshops: {
        holz: { label: "Holz", order: 1 },
        metall: { label: "Metall", order: 2 },
      },
      labels: {
        units: { h: "Std.", m2: "m²" },
        discounts: { none: "Normal", member: "Mitglied", intern: "Intern" },
      },
    })

    const configSnap = await db.doc("config/pricing").get()
    const config = configSnap.data()!
    expect(config.entryFees.erwachsen.regular).toBe(15)
    expect(config.workshops.holz.label).toBe("Holz")
  })

  it("queries active catalog items by workshop", async () => {
    const db = getAdminFirestore()

    await db.collection("catalog").doc("c1").set({
      code: "1001",
      name: "Laser Stunde",
      workshops: ["holz"],
      pricingModel: "time",
      unitPrice: { none: 20, member: 15 },
      active: true,
      userCanAdd: true,
    })
    await db.collection("catalog").doc("c2").set({
      code: "2001",
      name: "Schweissdraht",
      workshops: ["metall"],
      pricingModel: "weight",
      unitPrice: { none: 10 },
      active: true,
      userCanAdd: true,
    })
    await db.collection("catalog").doc("c3").set({
      code: "1002",
      name: "Inactive item",
      workshops: ["holz"],
      pricingModel: "count",
      unitPrice: { none: 5 },
      active: false,
      userCanAdd: true,
    })

    // Query: active items for "holz" workshop
    const snap = await db
      .collection("catalog")
      .where("active", "==", true)
      .where("userCanAdd", "==", true)
      .where("workshops", "array-contains", "holz")
      .get()

    expect(snap.size).toBe(1)
    expect(snap.docs[0].data().name).toBe("Laser Stunde")
  })
})
