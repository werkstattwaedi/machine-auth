// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #605: saved persons and per-person usage types in the wizard's
 * roster — saving ticked companions on advance (dedup, failures never
 * block), and the doc round trip incl. the fallback for checkouts from
 * before per-person types.
 */

import { describe, it, expect, vi } from "vitest"
import type { Firestore } from "firebase/firestore"
import type { CheckoutDoc, CheckoutPersonDoc } from "@modules/lib/firestore-entities"
import {
  applySavedLinks,
  personDocToLocal,
  personLocalToDoc,
  rehydratePersons,
  saveTickedCompanions,
} from "./wizard-context"
import type { CheckoutPerson, SavedPersonEntry } from "./use-checkout-state"

function typed(overrides: Partial<CheckoutPerson> & { id: string }): CheckoutPerson {
  return {
    firstName: "Noah",
    lastName: "Keller",
    email: "",
    userType: "kind",
    termsAccepted: true,
    isPreFilled: false,
    usageType: "regular",
    saveForLater: true,
    ...overrides,
  }
}

const owner: CheckoutPerson = {
  id: "p-owner",
  firstName: "Max",
  lastName: "Muster",
  email: "max@example.com",
  userType: "erwachsen",
  termsAccepted: true,
  isPreFilled: true,
  userId: "u-max",
  usageType: "materialbezug",
}

describe("saveTickedCompanions", () => {
  it("saves a ticked person with name and user type only", async () => {
    const addSaved = vi.fn().mockResolvedValue("s-new")
    const links = await saveTickedCompanions(
      [owner, typed({ id: "p2", usageType: "ermaessigt" })],
      [],
      addSaved,
    )
    expect(addSaved).toHaveBeenCalledTimes(1)
    expect(addSaved).toHaveBeenCalledWith({
      firstName: "Noah",
      lastName: "Keller",
      userType: "kind",
    })
    expect(links).toEqual([{ personId: "p2", savedPersonId: "s-new" }])
  })

  it("skips unticked persons, the owner and lines from a saved person", async () => {
    const addSaved = vi.fn().mockResolvedValue("s-new")
    const links = await saveTickedCompanions(
      [
        { ...owner, saveForLater: true },
        typed({ id: "p2", saveForLater: false }),
        typed({ id: "p3", savedPersonId: "s-old" }),
      ],
      [],
      addSaved,
    )
    expect(addSaved).not.toHaveBeenCalled()
    expect(links).toEqual([])
  })

  it("links instead of saving twice: same names and user type", async () => {
    const existing: SavedPersonEntry = {
      id: "s-noah",
      firstName: "noah ",
      lastName: "Keller",
      userType: "kind",
    }
    const addSaved = vi.fn().mockResolvedValue("s-new")
    const links = await saveTickedCompanions([typed({ id: "p2" })], [existing], addSaved)
    expect(addSaved).not.toHaveBeenCalled()
    expect(links).toEqual([{ personId: "p2", savedPersonId: "s-noah" }])
  })

  it("saves a namesake with another user type", async () => {
    const existing: SavedPersonEntry = {
      id: "s-noah",
      firstName: "Noah",
      lastName: "Keller",
      userType: "erwachsen",
    }
    const addSaved = vi.fn().mockResolvedValue("s-new")
    await saveTickedCompanions([typed({ id: "p2" })], [existing], addSaved)
    expect(addSaved).toHaveBeenCalledTimes(1)
  })

  it("dedupes within one batch", async () => {
    const addSaved = vi.fn().mockResolvedValue("s-new")
    const links = await saveTickedCompanions(
      [typed({ id: "p2" }), typed({ id: "p3" })],
      [],
      addSaved,
    )
    expect(addSaved).toHaveBeenCalledTimes(1)
    expect(links.map((l) => l.savedPersonId)).toEqual(["s-new", "s-new"])
  })

  it("never rejects: a failed save skips that person and goes on", async () => {
    const addSaved = vi
      .fn()
      .mockRejectedValueOnce(new Error("permission-denied"))
      .mockResolvedValueOnce("s-lea")
    const links = await saveTickedCompanions(
      [typed({ id: "p2" }), typed({ id: "p3", firstName: "Lea" })],
      [],
      addSaved,
    )
    expect(links).toEqual([{ personId: "p3", savedPersonId: "s-lea" }])
  })
})

const db = {} as Firestore

describe("save before persist (#605)", () => {
  it("the persisted line carries the new saved person", async () => {
    const roster = [owner, typed({ id: "p2" })]
    const links = await saveTickedCompanions(roster, [], async () => "s-new")
    const persisted = applySavedLinks(roster, links)
    expect(persisted[0]).toBe(owner)
    const doc = personLocalToDoc(persisted[1], db)
    expect(doc.savedPersonId).toBe("s-new")
    expect(persisted[1].saveForLater).toBe(false)
  })

  it("a duplicate links to the existing saved person", async () => {
    const roster = [owner, typed({ id: "p2" })]
    const existing: SavedPersonEntry = { id: "s-noah", firstName: "Noah", lastName: "Keller", userType: "kind" }
    const links = await saveTickedCompanions(roster, [existing], vi.fn())
    const doc = personLocalToDoc(applySavedLinks(roster, links)[1], db)
    expect(doc.savedPersonId).toBe("s-noah")
  })

  it("a failed save still yields the whole roster, unlinked", async () => {
    const roster = [owner, typed({ id: "p2" })]
    const links = await saveTickedCompanions(roster, [], () =>
      Promise.reject(new Error("permission-denied")),
    )
    const persisted = applySavedLinks(roster, links)
    expect(persisted).toEqual(roster)
    expect(persisted[1].saveForLater).toBe(true)
  })
})

describe("person doc round trip (#605)", () => {
  it("carries usage type and saved-person link", () => {
    const local = typed({ id: "p2", usageType: "ermaessigt", savedPersonId: "s-1" })
    const doc = personLocalToDoc(local, db)
    expect(doc.usageType).toBe("ermaessigt")
    expect(doc.savedPersonId).toBe("s-1")
    const back = personDocToLocal(doc)
    expect(back.usageType).toBe("ermaessigt")
    expect(back.savedPersonId).toBe("s-1")
  })

  it("omits the link on a typed-in line", () => {
    const doc = personLocalToDoc(typed({ id: "p2" }), db)
    expect("savedPersonId" in doc).toBe(false)
  })
})

function checkout(
  usageType: string,
  persons: CheckoutPersonDoc[],
): Pick<CheckoutDoc, "persons" | "usageType"> {
  return { usageType, persons }
}

const ownerDoc: CheckoutPersonDoc = {
  name: "Max Muster",
  email: "max@example.com",
  userType: "erwachsen",
  userRef: { id: "u-max" } as CheckoutPersonDoc["userRef"],
}
const childDoc: CheckoutPersonDoc = { name: "Mia Muster", email: "", userType: "kind" }

describe("rehydratePersons — checkouts from before per-person types", () => {
  it("gives everyone the checkout's type", () => {
    const persons = rehydratePersons(checkout("ermaessigt", [ownerDoc, childDoc]), "u-max")
    expect(persons.map((p) => p.usageType)).toEqual(["ermaessigt", "ermaessigt"])
  })

  it("keeps an owner-only type on the owner alone", () => {
    const persons = rehydratePersons(checkout("volunteering", [ownerDoc]), "u-max")
    expect(persons[0].usageType).toBe("volunteering")
  })

  it("puts everyone on regular when an owner-only type meets others", () => {
    const persons = rehydratePersons(checkout("intern", [ownerDoc, childDoc]), "u-max")
    expect(persons.map((p) => p.usageType)).toEqual(["regular", "regular"])
  })

  it("prefers a person's own type", () => {
    const persons = rehydratePersons(
      checkout("regular", [{ ...ownerDoc, usageType: "materialbezug" }, childDoc]),
      "u-max",
    )
    expect(persons.map((p) => p.usageType)).toEqual(["materialbezug", "regular"])
  })
})
