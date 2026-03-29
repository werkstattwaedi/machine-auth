// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest"
import { FakeFirestore } from "./fake-firestore"

describe("FakeFirestore", () => {
  let db: FakeFirestore

  beforeEach(() => {
    db = new FakeFirestore()
  })

  describe("doc/collection refs", () => {
    it("creates doc refs with correct id and path", () => {
      const ref = db.doc("users", "abc")
      expect(ref.id).toBe("abc")
      expect(ref.path).toBe("users/abc")
      expect(ref.parent.path).toBe("users")
    })

    it("creates nested doc refs", () => {
      const ref = db.doc("checkouts", "co1", "items", "item1")
      expect(ref.id).toBe("item1")
      expect(ref.path).toBe("checkouts/co1/items/item1")
    })

    it("creates collection refs", () => {
      const ref = db.collection("users")
      expect(ref.id).toBe("users")
      expect(ref.path).toBe("users")
    })
  })

  describe("setDoc / getDoc", () => {
    it("stores and retrieves data", () => {
      const ref = db.doc("users", "u1")
      db.setDoc(ref, { name: "Max", age: 30 })

      const snap = db.getDoc(ref)
      expect(snap.exists()).toBe(true)
      expect(snap.data()).toEqual({ name: "Max", age: 30 })
      expect(snap.id).toBe("u1")
    })

    it("returns non-existent for missing docs", () => {
      const ref = db.doc("users", "missing")
      const snap = db.getDoc(ref)
      expect(snap.exists()).toBe(false)
      expect(snap.data()).toBeUndefined()
    })

    it("overwrites existing data", () => {
      const ref = db.doc("users", "u1")
      db.setDoc(ref, { name: "Max" })
      db.setDoc(ref, { name: "Anna" })

      expect(db.getDoc(ref).data()).toEqual({ name: "Anna" })
    })
  })

  describe("addDoc", () => {
    it("generates an auto ID", () => {
      const colRef = db.collection("users")
      const ref = db.addDoc(colRef, { name: "Max" })

      expect(ref.id).toBeTruthy()
      expect(db.getDoc(ref).data()).toEqual({ name: "Max" })
    })

    it("generates unique IDs", () => {
      const colRef = db.collection("users")
      const ref1 = db.addDoc(colRef, { name: "A" })
      const ref2 = db.addDoc(colRef, { name: "B" })
      expect(ref1.id).not.toBe(ref2.id)
    })
  })

  describe("updateDoc", () => {
    it("merges data into existing doc", () => {
      const ref = db.doc("users", "u1")
      db.setDoc(ref, { name: "Max", age: 30 })
      db.updateDoc(ref, { age: 31 })

      expect(db.getDoc(ref).data()).toEqual({ name: "Max", age: 31 })
    })

    it("throws for non-existent doc", () => {
      const ref = db.doc("users", "missing")
      expect(() => db.updateDoc(ref, { age: 31 })).toThrow()
    })
  })

  describe("deleteDoc", () => {
    it("removes a document", () => {
      const ref = db.doc("users", "u1")
      db.setDoc(ref, { name: "Max" })
      db.deleteDoc(ref)

      expect(db.getDoc(ref).exists()).toBe(false)
    })
  })

  describe("onSnapshotDoc", () => {
    it("fires immediately with current data", () => {
      const ref = db.doc("users", "u1")
      db.setDoc(ref, { name: "Max" })

      const callback = vi.fn()
      db.onSnapshotDoc(ref, callback)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0].data()).toEqual({ name: "Max" })
    })

    it("fires on updates", () => {
      const ref = db.doc("users", "u1")
      db.setDoc(ref, { name: "Max" })

      const callback = vi.fn()
      db.onSnapshotDoc(ref, callback)
      expect(callback).toHaveBeenCalledTimes(1)

      db.updateDoc(ref, { name: "Anna" })
      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback.mock.calls[1][0].data()).toEqual({ name: "Anna" })
    })

    it("fires on deletion", () => {
      const ref = db.doc("users", "u1")
      db.setDoc(ref, { name: "Max" })

      const callback = vi.fn()
      db.onSnapshotDoc(ref, callback)

      db.deleteDoc(ref)
      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback.mock.calls[1][0].exists()).toBe(false)
    })

    it("returns unsubscribe function", () => {
      const ref = db.doc("users", "u1")
      db.setDoc(ref, { name: "Max" })

      const callback = vi.fn()
      const unsub = db.onSnapshotDoc(ref, callback)
      expect(callback).toHaveBeenCalledTimes(1)

      unsub()
      db.updateDoc(ref, { name: "Anna" })
      expect(callback).toHaveBeenCalledTimes(1) // no more calls
    })
  })

  describe("onSnapshotCollection", () => {
    it("fires immediately with all docs", () => {
      db.setDoc(db.doc("users", "u1"), { name: "Max" })
      db.setDoc(db.doc("users", "u2"), { name: "Anna" })

      const callback = vi.fn()
      db.onSnapshotCollection(db.collection("users"), [], callback)

      expect(callback).toHaveBeenCalledTimes(1)
      const snap = callback.mock.calls[0][0]
      expect(snap.docs).toHaveLength(2)
      expect(snap.size).toBe(2)
      expect(snap.empty).toBe(false)
    })

    it("fires when docs are added", () => {
      const callback = vi.fn()
      db.onSnapshotCollection(db.collection("users"), [], callback)
      expect(callback.mock.calls[0][0].docs).toHaveLength(0)

      db.setDoc(db.doc("users", "u1"), { name: "Max" })
      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback.mock.calls[1][0].docs).toHaveLength(1)
    })

    it("fires when docs are deleted", () => {
      db.setDoc(db.doc("users", "u1"), { name: "Max" })

      const callback = vi.fn()
      db.onSnapshotCollection(db.collection("users"), [], callback)
      expect(callback.mock.calls[0][0].docs).toHaveLength(1)

      db.deleteDoc(db.doc("users", "u1"))
      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback.mock.calls[1][0].docs).toHaveLength(0)
    })
  })

  describe("where constraints", () => {
    beforeEach(() => {
      db.setDoc(db.doc("users", "u1"), { name: "Max", role: "admin" })
      db.setDoc(db.doc("users", "u2"), { name: "Anna", role: "member" })
      db.setDoc(db.doc("users", "u3"), { name: "Bob", role: "admin" })
    })

    it("filters with == operator", () => {
      const callback = vi.fn()
      db.onSnapshotCollection(
        db.collection("users"),
        [{ kind: "where", field: "role", op: "==", value: "admin" }],
        callback,
      )
      expect(callback.mock.calls[0][0].docs).toHaveLength(2)
    })

    it("filters with array-contains", () => {
      db.setDoc(db.doc("items", "i1"), { tags: ["wood", "metal"] })
      db.setDoc(db.doc("items", "i2"), { tags: ["glass"] })

      const callback = vi.fn()
      db.onSnapshotCollection(
        db.collection("items"),
        [{ kind: "where", field: "tags", op: "array-contains", value: "wood" }],
        callback,
      )
      expect(callback.mock.calls[0][0].docs).toHaveLength(1)
      expect(callback.mock.calls[0][0].docs[0].id).toBe("i1")
    })

    it("filters with in operator", () => {
      const callback = vi.fn()
      db.onSnapshotCollection(
        db.collection("users"),
        [{ kind: "where", field: "name", op: "in", value: ["Max", "Bob"] }],
        callback,
      )
      expect(callback.mock.calls[0][0].docs).toHaveLength(2)
    })

    it("compares document references by path", () => {
      const userRef = db.doc("users", "u1")
      db.setDoc(db.doc("checkouts", "co1"), { userId: userRef, status: "open" })
      db.setDoc(db.doc("checkouts", "co2"), { userId: db.doc("users", "u2"), status: "open" })

      const callback = vi.fn()
      const queryRef = db.doc("users", "u1") // different ref object, same path
      db.onSnapshotCollection(
        db.collection("checkouts"),
        [{ kind: "where", field: "userId", op: "==", value: queryRef }],
        callback,
      )
      expect(callback.mock.calls[0][0].docs).toHaveLength(1)
      expect(callback.mock.calls[0][0].docs[0].id).toBe("co1")
    })
  })

  describe("orderBy", () => {
    it("sorts ascending by default", () => {
      db.setDoc(db.doc("users", "u1"), { name: "Charlie", age: 30 })
      db.setDoc(db.doc("users", "u2"), { name: "Alice", age: 25 })
      db.setDoc(db.doc("users", "u3"), { name: "Bob", age: 35 })

      const callback = vi.fn()
      db.onSnapshotCollection(
        db.collection("users"),
        [{ kind: "orderBy", field: "name", direction: "asc" }],
        callback,
      )
      const names = callback.mock.calls[0][0].docs.map((d: { data: () => { name: string } }) => d.data().name)
      expect(names).toEqual(["Alice", "Bob", "Charlie"])
    })

    it("sorts descending", () => {
      db.setDoc(db.doc("users", "u1"), { age: 30 })
      db.setDoc(db.doc("users", "u2"), { age: 25 })
      db.setDoc(db.doc("users", "u3"), { age: 35 })

      const callback = vi.fn()
      db.onSnapshotCollection(
        db.collection("users"),
        [{ kind: "orderBy", field: "age", direction: "desc" }],
        callback,
      )
      const ages = callback.mock.calls[0][0].docs.map((d: { data: () => { age: number } }) => d.data().age)
      expect(ages).toEqual([35, 30, 25])
    })
  })

  describe("limit", () => {
    it("truncates results", () => {
      db.setDoc(db.doc("users", "u1"), { name: "A" })
      db.setDoc(db.doc("users", "u2"), { name: "B" })
      db.setDoc(db.doc("users", "u3"), { name: "C" })

      const callback = vi.fn()
      db.onSnapshotCollection(
        db.collection("users"),
        [{ kind: "limit", count: 2 }],
        callback,
      )
      expect(callback.mock.calls[0][0].docs).toHaveLength(2)
    })
  })

  describe("serverTimestamp", () => {
    it("resolves timestamp sentinel to Date", () => {
      const ref = db.doc("users", "u1")
      db.setDoc(ref, {
        name: "Max",
        created: { _fake: "serverTimestamp" },
      })

      const data = db.getDoc(ref).data()!
      expect(data.created).toBeInstanceOf(Date)
    })
  })

  describe("subcollections", () => {
    it("supports nested collection paths", () => {
      db.setDoc(db.doc("checkouts", "co1", "items", "i1"), { name: "Item 1" })
      db.setDoc(db.doc("checkouts", "co1", "items", "i2"), { name: "Item 2" })

      const callback = vi.fn()
      db.onSnapshotCollection(
        db.collection("checkouts/co1/items"),
        [],
        callback,
      )
      expect(callback.mock.calls[0][0].docs).toHaveLength(2)
    })
  })

  describe("clear", () => {
    it("removes all data and listeners", () => {
      db.setDoc(db.doc("users", "u1"), { name: "Max" })
      const callback = vi.fn()
      db.onSnapshotCollection(db.collection("users"), [], callback)

      db.clear()

      expect(db.getDoc(db.doc("users", "u1")).exists()).toBe(false)
      // After clear, adding data should not fire old listeners
      db.setDoc(db.doc("users", "u2"), { name: "Anna" })
      expect(callback).toHaveBeenCalledTimes(1) // only initial call
    })
  })

  describe("test helpers", () => {
    it("getData returns raw data", () => {
      db.setDoc(db.doc("users", "u1"), { name: "Max" })
      expect(db.getData("users", "u1")).toEqual({ name: "Max" })
    })

    it("getAllDocs returns all docs in collection", () => {
      db.setDoc(db.doc("users", "u1"), { name: "Max" })
      db.setDoc(db.doc("users", "u2"), { name: "Anna" })

      const all = db.getAllDocs("users")
      expect(all.size).toBe(2)
    })
  })
})
