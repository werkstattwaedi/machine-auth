// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Test fixture builder for populating FakeFirestore with test data.
 *
 * Usage:
 *   const fixture = new TestFixture()
 *     .withUser({ id: "u1", displayName: "Max", roles: ["vereinsmitglied"] })
 *     .withPermission({ id: "laser", name: "Laser Cutter" })
 *     .withMachine({ id: "m1", name: "Laser", requiredPermission: ["laser"] })
 *     .withPricingConfig({ ... })
 *
 *   const { db, auth } = fixture.buildFake({ currentUser: "u1" })
 */

import { FakeFirestore } from "./fake-firestore"
import { FakeAuth, createFakeUser, type FakeUser } from "./fake-auth"

// ── Input types (test-friendly, minimal required fields) ──

interface UserInput {
  id: string
  displayName?: string
  name?: string
  email?: string
  roles?: string[]
  permissions?: string[] // permission IDs
  userType?: string
  termsAcceptedAt?: Date | null
}

interface PermissionInput {
  id: string
  name: string
  description?: string
}

interface MachineInput {
  id: string
  name: string
  workshop?: string
  requiredPermission?: string[] // permission IDs
  maco?: string // maco device ID
}

interface CatalogItemInput {
  id: string
  code: string
  name: string
  workshops?: string[]
  pricingModel?: string
  unitPrice?: Record<string, number>
  active?: boolean
  userCanAdd?: boolean
}

interface CheckoutInput {
  id: string
  userId: string
  status?: "open" | "closed"
  usageType?: string
  workshopsVisited?: string[]
  items?: CheckoutItemInput[]
}

interface CheckoutItemInput {
  id: string
  workshop: string
  description: string
  origin?: "nfc" | "manual" | "qr"
  catalogId?: string | null
  quantity: number
  unitPrice: number
  totalPrice: number
}

interface MacoInput {
  id: string
  name: string
  location?: string
}

interface PricingConfigInput {
  entryFees?: Record<string, Record<string, number>>
  workshops?: Record<string, { label: string; order: number }>
  labels?: {
    units?: Record<string, string>
    discounts?: Record<string, string>
  }
}

// ── Builder ──

export class TestFixture {
  private users: UserInput[] = []
  private permissions: PermissionInput[] = []
  private machines: MachineInput[] = []
  private catalogItems: CatalogItemInput[] = []
  private checkouts: CheckoutInput[] = []
  private macos: MacoInput[] = []
  private pricingConfig: PricingConfigInput | null = null

  withUser(input: UserInput): this {
    this.users.push(input)
    return this
  }

  withPermission(input: PermissionInput): this {
    this.permissions.push(input)
    return this
  }

  withMachine(input: MachineInput): this {
    this.machines.push(input)
    return this
  }

  withCatalogItem(input: CatalogItemInput): this {
    this.catalogItems.push(input)
    return this
  }

  withCheckout(input: CheckoutInput): this {
    this.checkouts.push(input)
    return this
  }

  withMaco(input: MacoInput): this {
    this.macos.push(input)
    return this
  }

  withPricingConfig(config: PricingConfigInput): this {
    this.pricingConfig = config
    return this
  }

  /**
   * Build a FakeFirestore populated with all fixture data.
   * Optionally set a current user for FakeAuth.
   */
  buildFake(options?: { currentUser?: string }): {
    db: FakeFirestore
    auth: FakeAuth
    user: FakeUser | null
  } {
    const db = new FakeFirestore()
    const auth = new FakeAuth()

    // Seed permissions
    for (const p of this.permissions) {
      db.setDoc(db.doc("permission", p.id), {
        name: p.name,
        description: p.description ?? "",
      })
    }

    // Seed users
    for (const u of this.users) {
      const permissionRefs = (u.permissions ?? []).map((pid) =>
        db.doc("permission", pid),
      )
      db.setDoc(db.doc("users", u.id), {
        displayName: u.displayName ?? u.id,
        name: u.name ?? "",
        email: u.email ?? `${u.id}@test.com`,
        roles: u.roles ?? ["vereinsmitglied"],
        permissions: permissionRefs,
        userType: u.userType ?? "erwachsen",
        termsAcceptedAt: u.termsAcceptedAt ?? null,
        created: new Date(),
      })
    }

    // Seed machines
    for (const m of this.machines) {
      const permRefs = (m.requiredPermission ?? []).map((pid) =>
        db.doc("permission", pid),
      )
      db.setDoc(db.doc("machine", m.id), {
        name: m.name,
        workshop: m.workshop ?? "",
        requiredPermission: permRefs,
        ...(m.maco ? { maco: db.doc("maco", m.maco) } : {}),
      })
    }

    // Seed catalog items
    for (const c of this.catalogItems) {
      db.setDoc(db.doc("catalog", c.id), {
        code: c.code,
        name: c.name,
        workshops: c.workshops ?? [],
        pricingModel: c.pricingModel ?? "count",
        unitPrice: c.unitPrice ?? { none: 0 },
        active: c.active ?? true,
        userCanAdd: c.userCanAdd ?? true,
      })
    }

    // Seed MaCo terminals
    for (const m of this.macos) {
      db.setDoc(db.doc("maco", m.id), {
        name: m.name,
        location: m.location ?? "",
      })
    }

    // Seed checkouts
    for (const co of this.checkouts) {
      db.setDoc(db.doc("checkouts", co.id), {
        userId: db.doc("users", co.userId),
        status: co.status ?? "open",
        usageType: co.usageType ?? "regular",
        workshopsVisited: co.workshopsVisited ?? [],
        created: new Date(),
        persons: [],
      })

      // Seed checkout items
      for (const item of co.items ?? []) {
        db.setDoc(db.doc("checkouts", co.id, "items", item.id), {
          workshop: item.workshop,
          description: item.description,
          origin: item.origin ?? "manual",
          catalogId: item.catalogId ? db.doc("catalog", item.catalogId) : null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          created: new Date(),
        })
      }
    }

    // Seed pricing config
    if (this.pricingConfig) {
      db.setDoc(db.doc("config", "pricing"), {
        entryFees: this.pricingConfig.entryFees ?? {},
        workshops: this.pricingConfig.workshops ?? {},
        labels: this.pricingConfig.labels ?? { units: {}, discounts: {} },
      })
    }

    // Set up auth
    let currentFakeUser: FakeUser | null = null
    if (options?.currentUser) {
      const userData = this.users.find((u) => u.id === options.currentUser)
      if (userData) {
        currentFakeUser = createFakeUser({
          uid: userData.id,
          email: userData.email,
          displayName: userData.displayName,
          claims: userData.roles?.includes("admin") ? { admin: true } : {},
        })
        auth.setCurrentUser(currentFakeUser)
      }
    }

    return { db, auth, user: currentFakeUser }
  }

  // ── Presets ──

  /** A member user with an open checkout and some items */
  static memberWithCheckout(): TestFixture {
    return new TestFixture()
      .withPermission({ id: "laser", name: "Laser Cutter" })
      .withUser({
        id: "member1",
        displayName: "Max Muster",
        name: "Max Muster",
        email: "max@test.com",
        roles: ["vereinsmitglied"],
        permissions: ["laser"],
      })
      .withPricingConfig({
        entryFees: {
          erwachsen: { regular: 15, materialbezug: 0, intern: 0 },
          kind: { regular: 7.5, materialbezug: 0, intern: 0 },
          firma: { regular: 30, materialbezug: 0, intern: 0 },
        },
        workshops: {
          holz: { label: "Holz", order: 1 },
          metall: { label: "Metall", order: 2 },
        },
      })
      .withCatalogItem({
        id: "c1",
        code: "1001",
        name: "Laser Stunde",
        workshops: ["holz"],
        pricingModel: "time",
        unitPrice: { none: 20, member: 15, intern: 0 },
      })
      .withCheckout({
        id: "co1",
        userId: "member1",
        status: "open",
        workshopsVisited: ["holz"],
        items: [
          {
            id: "item1",
            workshop: "holz",
            description: "Laser Stunde",
            quantity: 1,
            unitPrice: 15,
            totalPrice: 15,
          },
        ],
      })
  }

  /** Admin user with machines, users, and permissions */
  static adminDashboard(): TestFixture {
    return new TestFixture()
      .withPermission({ id: "laser", name: "Laser Cutter" })
      .withPermission({ id: "cnc", name: "CNC Fräse" })
      .withUser({
        id: "admin1",
        displayName: "Admin",
        roles: ["admin"],
        permissions: ["laser", "cnc"],
      })
      .withUser({
        id: "user1",
        displayName: "Max Muster",
        roles: ["vereinsmitglied"],
        permissions: ["laser"],
      })
      .withMachine({
        id: "m1",
        name: "Laser",
        workshop: "holz",
        requiredPermission: ["laser"],
      })
      .withMachine({
        id: "m2",
        name: "CNC",
        workshop: "metall",
        requiredPermission: ["cnc"],
      })
  }
}
